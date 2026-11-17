package app.boltwork.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private val fixtures = File(System.getProperty("boltwork.fixtures"))
private val vectors = Json.parseToJsonElement(File(fixtures, "vectors.json").readText()).jsonObject
private fun JsonObject.s(key: String) = getValue(key).jsonPrimitive.content
private fun unhex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

/** A scratch copy of the fixture vault, so tests can write to it. */
private fun fixtureVault(): File {
    val dir = Files.createTempDirectory("boltwork-test").toFile()
    File(fixtures, "vault").copyRecursively(dir)
    return dir
}

class CryptoTest {
    @Test fun blake2b() {
        for (v in vectors.getValue("blake").jsonArray.map { it.jsonObject }) {
            val msg = unhex(v.s("msg"))
            assertEquals(v.s("out32"), VaultCrypto.blake2b(msg, 32, unhex(v.s("key"))).hex())
            assertEquals(v.s("out64Unkeyed"), VaultCrypto.blake2b(msg, 64).hex())
        }
    }

    @Test fun argon2id() {
        for (v in vectors.getValue("argon").jsonArray.map { it.jsonObject }) {
            val out = VaultCrypto.argon2id(v.s("password").toByteArray(), unhex(v.s("salt")), v.getValue("ops").jsonPrimitive.int, v.getValue("memKiB").jsonPrimitive.int)
            assertEquals(v.s("out"), out.hex())
        }
    }

    @Test fun xchacha() {
        for (v in vectors.getValue("xchacha").jsonArray.map { it.jsonObject }) {
            val key = unhex(v.s("key")); val nonce = unhex(v.s("nonce")); val msg = unhex(v.s("msg")); val aad = v.s("aad").toByteArray()
            assertEquals(v.s("c"), XChaCha20Poly1305.seal(msg, key, nonce, aad).hex())
            assertContentEquals(msg, XChaCha20Poly1305.open(unhex(v.s("c")), key, nonce, aad))
            assertFailsWith<VaultError.DecryptionFailed> { XChaCha20Poly1305.open(unhex(v.s("c")), key, nonce, "other".toByteArray()) }
        }
    }

    @Test fun keyDerivation() {
        val v = vectors.getValue("keyDerivation").jsonObject
        assertEquals(v.s("normalized"), SecretKey.normalize(v.s("secretKey")))
        val kdf = Json.decodeFromJsonElement(KdfParams.serializer(), v.getValue("kdf"))
        val kek = VaultCrypto.deriveKek(v.s("password"), v.s("secretKey"), kdf)
        assertEquals(v.s("kek"), kek.hex())
        assertEquals(v.s("authKey"), VaultCrypto.authKey(kek).hex())
    }

    @Test fun secretKeys() {
        val key = SecretKey.generate()
        assertEquals(key, SecretKey.normalize(key.lowercase().replace("-", " ")))
        assertFailsWith<VaultError.InvalidSecretKey> { SecretKey.normalize("SR1-TOO-SHORT") }
    }
}

class VaultStoreTest {
    private val kd = vectors.getValue("keyDerivation").jsonObject
    private fun unlock(dir: File) = VaultStore.open(dir, VaultStore.masterKey(dir, kd.s("password"), kd.s("secretKey")))

    @Test fun opensFixtureVault() {
        val store = unlock(fixtureVault())
        assertEquals(listOf("Personal"), store.vaults.map { it.name })
        val item = store.item(vectors.s("itemId"))
        assertEquals("Example", item.title)
        assertTrue(item.favorite)
        assertEquals("alice@example.com", item.content.field(FieldPurpose.username)?.value)
        assertEquals("newer-password", item.content.field(FieldPurpose.password)?.value)
        assertEquals("hunter2-but-longer", item.history.first().content.field(FieldPurpose.password)?.value)
        assertEquals(listOf("work/email", "favorites"), item.content.tags)
        assertEquals("Line one\nLine two", store.items.first { it.title == "Wi-Fi notes" }.content.notes)
        val (meta, bytes) = store.readAttachment(item.id, item.attachments.first().id)
        assertEquals("hello.txt", meta.name)
        assertEquals("hello attachment", String(bytes))
    }

    @Test fun wrongPassword() {
        val dir = fixtureVault()
        assertFailsWith<VaultError.WrongPassword> { VaultStore.masterKey(dir, "nope nope", kd.s("secretKey")) }
        assertFailsWith<VaultError.WrongPassword> { VaultStore.open(dir, ByteArray(32) { 7 }) }
    }

    @Test fun savingResealsOnlyThatRecord() {
        val dir = fixtureVault()
        val store = unlock(dir)
        val id = vectors.s("itemId")
        val before = store.allRecords.associate { it.id to it.data }
        val item = store.item(id)
        store.saveItem(id, item.vaultId, item.content.copy(notes = "edited"))
        val after = store.allRecords.associate { it.id to it.data }
        assertEquals(setOf(id), after.keys.filter { after[it] != before[it] }.toSet())
        val again = unlock(dir).item(id)
        assertEquals("edited", again.content.notes)
        assertEquals(2, again.history.size)
    }

    @Test fun keepsUnknownFields() {
        val dir = fixtureVault()
        val store = unlock(dir)
        val item = store.item(vectors.s("itemId"))
        val passkeys = JsonArray(listOf(JsonObject(mapOf("credentialId" to JsonPrimitive("abc"), "rpId" to JsonPrimitive("example.com")))))
        val text = Json.encodeToString(Item.serializer(), item.copy(extras = mapOf("passkeys" to passkeys, "futureField" to JsonNull)))
        val back = Json.decodeFromString(Item.serializer(), text)
        assertEquals(passkeys, back.extras["passkeys"])
        assertEquals(JsonNull, back.extras["futureField"])
        assertEquals(1, back.passkeyCount)
        assertEquals(item.content, back.content)
    }

    @Test fun createAndReopen() {
        val dir = Files.createTempDirectory("boltwork-new").toFile()
        val key = SecretKey.generate()
        val store = VaultStore.open(VaultStore.create(dir, "correct horse battery", key, VaultCrypto.fastCostForTests), dir)
        val saved = store.saveItem(null, store.vaults[0].id, ItemTemplate.blankContent(ItemCategory.login).copy(title = "  Site  ", tags = listOf("a", "a", " ")))
        assertEquals("Site", saved.title)
        assertEquals(listOf("a"), saved.content.tags)
        store.trash(saved.id)
        val again = VaultStore.open(dir, VaultStore.masterKey(dir, "correct horse battery", key))
        assertEquals(ItemState.deleted, again.item(saved.id).state)
        assertEquals(1, again.emptyTrash())
        assertTrue(again.dirtyRecords.any { it.id == saved.id && it.isDeleted })
    }
}

class SmallThingsTest {
    @Test fun totp() {
        val totp = Totp("JBSWY3DPEHPK3PXP")
        for (v in vectors.getValue("totp").jsonArray.map { it.jsonObject }) {
            assertEquals(v.s("code"), totp.code(v.getValue("t").jsonPrimitive.long))
        }
        val link = Totp("otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=8&period=60&algorithm=SHA256")
        assertEquals("Example", link.issuer)
        assertEquals("alice@example.com", link.account)
        assertEquals(8, link.digits)
        assertEquals(8, link.code(0).length)
        assertFailsWith<Totp.ParseError> { Totp("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP") }
        assertFailsWith<Totp.ParseError> { Totp("not base32 !") }
    }

    @Test fun setupCode() {
        val code = SetupCode("https://vault.example.com", null, "a@example.com", "SR1-AAAAA")
        assertEquals("""boltwork-setup:{"v":1,"server":"https://vault.example.com","email":"a@example.com","secretKey":"SR1-AAAAA"}""", code.text)
        assertEquals(code, SetupCode.parse(" ${code.text}\n"))
        assertFailsWith<SetupCode.Error> { SetupCode.parse("hello") }
        assertFailsWith<SetupCode.Error> { SetupCode.parse("""boltwork-setup:{"v":2,"secretKey":"x"}""") }
    }

    @Test fun serverUrl() {
        assertEquals("https://vault.example.com", SyncServerURL.normalize(" vault.example.com/ "))
        assertEquals("http://192.168.1.20:8787", SyncServerURL.normalize("192.168.1.20:8787"))
        assertEquals("http://100.73.1.2:8787", SyncServerURL.normalize("http://100.73.1.2:8787/"))
        assertEquals("http://localhost:8787", SyncServerURL.normalize("localhost:8787"))
        assertEquals("http://[::1]:8787", SyncServerURL.normalize("http://[::1]:8787"))
        assertFailsWith<SyncServerURL.Invalid> { SyncServerURL.normalize("http://vault.example.com") }
        assertFailsWith<SyncServerURL.Invalid> { SyncServerURL.normalize("  ") }
    }

    @Test fun generator() {
        assertTrue(PasswordGenerator.words.size > 7000)
        val p = PasswordGenerator.generate(GeneratorOptions(length = 30, avoidAmbiguous = true))
        assertEquals(30, p.length)
        assertTrue(p.any { it.isDigit() } && p.any { it.isUpperCase() } && p.any { it.isLowerCase() } && p.any { !it.isLetterOrDigit() })
        assertEquals(5, PasswordGenerator.generate(GeneratorOptions(mode = GeneratorMode.Words, wordCount = 5)).split("-").size)
        assertTrue(PasswordGenerator.generate(GeneratorOptions(mode = GeneratorMode.Pin, pinLength = 8)).matches(Regex("\\d{8}")))
    }

    @Test fun subtitlesAndSearch() {
        val login = ItemTemplate.blankContent(ItemCategory.login).let { c -> c.copy(title = "Example", fields = c.fields.map { if (it.id == "username") it.copy(value = "alice") else it }) }
        assertEquals("alice", login.subtitle)
        val items = listOf(Item("1", "v", login, createdAt = 1))
        assertEquals(1, items.search("exam ali").size)
        assertEquals(0, items.search("bob").size)
        assertEquals(22, ItemTemplate.all.size)
        assertNotNull(ItemTemplate.of(ItemCategory.medicalRecord))
    }
}

/** Runs against a real sync server when `BOLTWORK_TEST_SERVER` is set. */
class SyncTest {
    @Test fun twoDevices() {
        val server = System.getProperty("boltwork.testServer").orEmpty()
        if (server.isEmpty()) return
        val email = "test-${VaultCrypto.randomId()}@example.com"
        val password = "correct horse battery"
        val secretKey = SecretKey.generate()

        // Device A makes the account.
        val dirA = Files.createTempDirectory("boltwork-a").toFile()
        val a = VaultStore.open(VaultStore.create(dirA, password, secretKey, VaultCrypto.fastCostForTests), dirA)
        val clientA = SyncClient(server)
        clientA.signup(email, VaultStore.authKey(a.keyset, password, secretKey), a.keyset, "Test A")
        a.syncState = SyncState(server, email)
        val login = ItemTemplate.blankContent(ItemCategory.login).copy(title = "From A")
        val item = a.saveItem(null, a.vaults[0].id, login)
        val att = a.addAttachment(item.id, "hello.txt", "text/plain", "hello".toByteArray())
        val first = SyncEngine.syncOnce(a, clientA)
        assertEquals(2, first.pushed)
        assertEquals(1, first.filesUp)

        // Device B signs in and pulls.
        val clientB = SyncClient(server)
        val reply = SyncEngine.signIn(clientB, email, password, secretKey, "Test B")
        val keyset = Keyset(reply.kdf, reply.wrappedKey, reply.accountId)
        val dirB = Files.createTempDirectory("boltwork-b").toFile()
        val b = VaultStore.createFromRemote(dirB, keyset, VaultStore.masterKey(keyset, password, secretKey), SyncState(server, email))
        val pulled = SyncEngine.syncOnce(b, clientB)
        assertEquals(2, pulled.pulled)
        assertEquals(1, pulled.filesDown)
        assertEquals("From A", b.item(item.id).title)
        assertEquals("hello", String(b.readAttachment(item.id, att.id).second))

        // Both edit the same item; the later edit wins and the other lands in history.
        a.saveItem(item.id, item.vaultId, a.item(item.id).content.copy(notes = "from A"))
        Thread.sleep(5)
        b.saveItem(item.id, item.vaultId, b.item(item.id).content.copy(notes = "from B"))
        SyncEngine.syncOnce(a, clientA)
        val merged = SyncEngine.syncOnce(b, clientB)
        assertEquals(1, merged.conflicts)
        SyncEngine.syncOnce(a, clientA)
        assertEquals("from B", a.item(item.id).content.notes)
        assertEquals("from B", b.item(item.id).content.notes)
        assertTrue(a.item(item.id).history.any { it.content.notes == "from A" })
        SyncEngine.syncOnce(b, clientB)
        assertFalse(clientB.waitForChanges(b.syncState!!.cursor, wait = 1).changed)
        assertTrue(clientB.waitForChanges(0, wait = 1).changed)

        assertFailsWith<SyncError> { SyncEngine.signIn(SyncClient(server), email, "wrong password", secretKey, "Test C") }
        assertEquals(2, clientA.account().devices.size)
    }

    private fun assertFalse(value: Boolean) = assertTrue(!value)
}

class WatchtowerTest {
    @Test fun strengthScale() {
        assertEquals(0, PasswordStrength("").level)
        assertTrue(PasswordStrength("password").isWeak)
        assertTrue(PasswordStrength("aaaaaaaa").isWeak)
        assertTrue(PasswordStrength("qwerty123").isWeak)
        assertTrue(!PasswordStrength(PasswordGenerator.generate()).isWeak)
        assertTrue(PasswordStrength(PasswordGenerator.generate()).level >= 6)
        assertTrue(PasswordStrength("Tr0ub4dor&3-much-longer").level >= 5)
        assertTrue(PasswordStrength("T").level <= 1)
    }

    @Test fun findsReusedWeakAndUnsecured() {
        fun login(id: String, pw: String, url: String): Item {
            val c = ItemTemplate.blankContent(ItemCategory.login)
            val fields = c.fields.toMutableList().also { it[1] = it[1].copy(value = pw) }
            return Item(id, "v", c.copy(title = id, fields = fields, urls = listOf(ItemUrl(url = url))), createdAt = 0)
        }
        val report = Watchtower.run(listOf(login("a", "password", "http://example.com"), login("b", "password", "https://b.com"), login("c", "Correct-Horse-Battery-Staple-9", "https://c.com")))
        assertEquals(2, report.count(WatchtowerCheck.reused))
        assertEquals(2, report.count(WatchtowerCheck.weak))
        assertEquals(1, report.count(WatchtowerCheck.unsecured))
        assertTrue(report.score < 1000)
    }

    @Test fun expiryFormats() {
        val endOf2030Jan = java.time.LocalDate.of(2030, 2, 1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli() - 1.0
        assertEquals(endOf2030Jan, Watchtower.parseExpiry("01/30"))
        assertEquals(endOf2030Jan, Watchtower.parseExpiry("2030-01"))
        assertEquals(endOf2030Jan, Watchtower.parseExpiry("2030-01-31"))
        assertEquals(java.time.LocalDate.of(2031, 1, 1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli() - 1.0, Watchtower.parseExpiry("12/2030"))
        assertEquals("5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8", Watchtower.sha1Hex("password"))
    }
}

class ItemToolsTest {
    @Test fun historyAttachmentsAndDuplicates() {
        val dir = java.nio.file.Files.createTempDirectory("boltwork-tools").toFile()
        val store = VaultStore.open(VaultStore.create(dir, "correct horse battery", SecretKey.generate(), VaultCrypto.fastCostForTests), dir)
        val vault = store.vaults.first().id
        val first = store.saveItem(null, vault, ItemTemplate.blankContent(ItemCategory.login).copy(title = "One"))
        val edited = store.saveItem(first.id, vault, first.content.copy(title = "Two"))
        assertEquals("One", edited.history.first().content.title)
        val restored = store.restoreVersion(first.id, 0)
        assertEquals("One", restored.title)
        assertTrue(restored.history.any { it.content.title == "Two" })

        val att = store.addAttachment(first.id, "a.txt", "text/plain", "hello".toByteArray())
        assertEquals("hello", String(store.readAttachment(first.id, att.id).second))
        store.removeAttachment(first.id, att.id)
        assertTrue(store.item(first.id).attachments.isEmpty())
        assertTrue(!store.hasAttachmentFile(att.id))

        val copy = store.duplicateItem(first.id)
        assertEquals("One (copy)", copy.title)
        assertTrue(copy.id != first.id)
    }
}

class SSHKeyTest {
    private fun run(dir: File, vararg args: String): String {
        val p = ProcessBuilder(*args).directory(dir).redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText()
        p.waitFor()
        return out
    }

    /** Keys from ssh-keygen read the same here, and keys written here read back in ssh-keygen. */
    @Test fun matchesSshKeygen() {
        if (!File("/usr/bin/ssh-keygen").exists()) return
        val dir = Files.createTempDirectory("boltwork-ssh").toFile()
        for ((name, type) in listOf("ed" to "ed25519", "rsa" to "rsa")) {
            run(dir, "ssh-keygen", "-q", "-t", type, *(if (type == "rsa") arrayOf("-b", "3072") else emptyArray()), "-N", "", "-C", "test@example", "-f", name)
            val key = SSHKey.parse(File(dir, name).readText())
            val pub = File(dir, "$name.pub").readText().trim()
            assertEquals(pub, key.publicKeyLine)
            assertTrue(run(dir, "ssh-keygen", "-l", "-f", "$name.pub").contains(key.fingerprint))
            File(dir, "$name-bw").writeText(key.openSSH)
            File(dir, "$name-bw").setReadable(false, false); File(dir, "$name-bw").setReadable(true, true)
            assertTrue(run(dir, "ssh-keygen", "-y", "-f", "$name-bw").startsWith(pub.split(" ").take(2).joinToString(" ")))
        }
        assertEquals("RSA 3072-bit", SSHKey.parse(File(dir, "rsa").readText()).typeName)
        val made = SSHKey.generateEd25519("new")
        assertEquals(made.publicKeyLine, SSHKey.parse(made.openSSH).publicKeyLine)
        File(dir, "made").writeText(made.openSSH)
        File(dir, "made").setReadable(false, false); File(dir, "made").setReadable(true, true)
        assertTrue(run(dir, "ssh-keygen", "-y", "-f", "made").startsWith(made.publicKeyLine.split(" ").take(2).joinToString(" ")))
        assertFailsWith<SSHKey.Failure> { SSHKey.parse("not a key") }
    }
}

class PasswordChangeTest {
    @Test fun rewrapKeepsTheMasterKey() {
        val dir = Files.createTempDirectory("boltwork-rewrap").toFile()
        val secretKey = SecretKey.generate()
        val store = VaultStore.open(VaultStore.create(dir, "correct horse battery", secretKey, VaultCrypto.fastCostForTests), dir)
        val master = store.masterKeyCopy()
        assertFailsWith<VaultError.WrongPassword> { VaultStore.rewrap(store.keyset, master, "wrong password", "new password 123", secretKey) }
        val (keyset, _) = VaultStore.rewrap(store.keyset, master, "correct horse battery", "new password 123", secretKey)
        store.adopt(keyset)
        assertContentEquals(master, VaultStore.masterKey(dir, "new password 123", secretKey))
        assertFailsWith<VaultError.WrongPassword> { VaultStore.masterKey(dir, "correct horse battery", secretKey) }
    }
}

class LoginMatchTest {
    private fun login(url: String, pw: String = "pw") = Item(
        "id-$url", "v",
        ItemTemplate.blankContent(ItemCategory.login).let { c -> c.copy(title = url, urls = listOf(ItemUrl(url = url)), fields = c.fields.map { if (it.purpose == FieldPurpose.password) it.copy(value = pw) else it }) },
        createdAt = 0,
    )

    @Test fun websitesAndApps() {
        val shop = login("https://shop.example.com/login")
        val other = login("https://example.org")
        val app = login("androidapp://com.example.app")
        assertEquals(listOf(shop), LoginMatch("accounts.example.com", "com.android.chrome").logins(listOf(shop, other, app)))
        assertEquals(listOf(app), LoginMatch(null, "com.example.app").logins(listOf(shop, other, app)))
        assertEquals(listOf(shop, app).toSet(), LoginMatch(null, "com.example.app").logins(listOf(shop, other, app), guesses = true).toSet())
        assertTrue(LoginMatch("evil.com", "com.android.chrome").logins(listOf(shop, other, app)).isEmpty())
        assertTrue(LoginMatch("bbc.co.uk", null).matches(login("news.bbc.co.uk")))
        assertTrue(!LoginMatch("other.co.uk", null).matches(login("bbc.co.uk")))
        assertEquals("androidapp://com.example.app", LoginMatch(null, "com.example.app").saveAddress)
        assertTrue(LoginMatch("example.com", null).logins(listOf(login("example.com", pw = ""))).isEmpty())
    }
}
