package app.boltwork.core

import java.security.SecureRandom

enum class GeneratorMode { Characters, Words, Pin }

enum class WordSeparator { Hyphens, Spaces, Periods, Commas, Underscores, Digits, DigitsAndSymbols }

/** Same defaults as the other apps' generator settings. */
data class GeneratorOptions(
    val mode: GeneratorMode = GeneratorMode.Characters,
    val length: Int = 20,
    val digits: Boolean = true,
    val symbols: Boolean = true,
    val avoidAmbiguous: Boolean = false,
    val wordCount: Int = 4,
    val separator: WordSeparator = WordSeparator.Hyphens,
    val capitalize: Boolean = true,
    val fullWords: Boolean = true,
    val pinLength: Int = 6,
)

/** Random, memorable and PIN passwords (see `src/core/generator.ts`). */
object PasswordGenerator {
    private const val LOWER = "abcdefghijklmnopqrstuvwxyz"
    private const val UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    private const val DIGITS = "0123456789"
    private const val SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/~"
    private const val AMBIGUOUS = "Il1O0o|`'\""
    private const val CONSONANTS = "bcdfghjklmnpqrstvwxz"
    private val random = SecureRandom()

    /** The EFF Large Wordlist (CC BY 3.0). */
    val words: List<String> by lazy {
        PasswordGenerator::class.java.getResourceAsStream("/wordlist.txt")?.bufferedReader()?.use { r -> r.readLines().filter { it.isNotEmpty() } }.orEmpty()
    }

    private fun pick(s: String): Char = s[random.nextInt(s.length)]

    fun generate(o: GeneratorOptions = GeneratorOptions()): String = when (o.mode) {
        GeneratorMode.Words -> memorable(o)
        GeneratorMode.Pin -> String(CharArray(o.pinLength.coerceIn(3, 12)) { pick(DIGITS) })
        GeneratorMode.Characters -> characters(o)
    }

    private fun characters(o: GeneratorOptions): String {
        fun strip(s: String) = if (o.avoidAmbiguous) s.filter { it !in AMBIGUOUS } else s
        val sets = buildList {
            add(strip(LOWER)); add(strip(UPPER))
            if (o.digits) add(strip(DIGITS))
            if (o.symbols) add(strip(SYMBOLS))
        }
        val length = maxOf(minOf(o.length, 100), sets.size)
        // One character from each enabled set, the rest from all of them.
        val all = sets.joinToString("")
        val chars = sets.map(::pick).toMutableList()
        while (chars.size < length) chars.add(pick(all))
        chars.shuffle(random)
        return String(chars.toCharArray())
    }

    private fun syllable() = "${pick(CONSONANTS)}${pick("aeiouy")}${pick(CONSONANTS)}"

    private fun memorable(o: GeneratorOptions): String {
        val list = List(o.wordCount.coerceIn(3, 15)) {
            val w = if (o.fullWords && words.isNotEmpty()) words[random.nextInt(words.size)] else if (o.fullWords) syllable() else syllable() + syllable()
            if (o.capitalize) w.replaceFirstChar { it.uppercase() } else w
        }
        return when (o.separator) {
            WordSeparator.Digits, WordSeparator.DigitsAndSymbols -> {
                val pool = if (o.separator == WordSeparator.Digits) DIGITS else DIGITS + SYMBOLS
                list.drop(1).fold(list[0]) { acc, w -> acc + pick(pool) + w }
            }
            WordSeparator.Hyphens -> list.joinToString("-")
            WordSeparator.Spaces -> list.joinToString(" ")
            WordSeparator.Periods -> list.joinToString(".")
            WordSeparator.Commas -> list.joinToString(",")
            WordSeparator.Underscores -> list.joinToString("_")
        }
    }
}
