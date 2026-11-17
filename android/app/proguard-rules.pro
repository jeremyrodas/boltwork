# Argon2 runs in native code that calls back into these classes by name.
-keep class com.lambdapioneer.argon2kt.** { *; }
# Bouncy Castle looks some algorithms up by reflection.
-keep class org.bouncycastle.crypto.** { *; }
-dontwarn org.bouncycastle.**
