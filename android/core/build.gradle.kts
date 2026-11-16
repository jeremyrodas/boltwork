plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
}

kotlin {
    jvmToolchain(17)
}

// The word list and the test fixtures are shared with the Apple apps rather than copied.
val appleKit = rootProject.layout.projectDirectory.dir("../apple/BoltworkKit")

sourceSets {
    main {
        resources {
            srcDir(appleKit.dir("Sources/BoltworkKit/Generator"))
            include("wordlist.txt")
        }
    }
}

dependencies {
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.13.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.87")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    systemProperty("boltwork.fixtures", appleKit.dir("Tests/BoltworkKitTests/Fixtures").asFile.path)
    // Set by tools/sync-test.sh: a local sync server to test against.
    System.getenv("BOLTWORK_TEST_SERVER")?.let { systemProperty("boltwork.testServer", it) }
    maxHeapSize = "1g"
}
