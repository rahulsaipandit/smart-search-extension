plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.smartphotos.frame"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.smartphotos.frame"
        minSdk = 24
        targetSdk = 28          // Fire HD 10 (9th gen) = Android 9
        versionCode = 1
        versionName = "0.1"
        ndk { abiFilters += listOf("armeabi-v7a") }   // the tablet is 32-bit only
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
    androidResources { noCompress += listOf("onnx") }
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.31.1")
    implementation("com.alphacephei:vosk-android:0.3.75")
    implementation("net.java.dev.jna:jna:5.18.1@aar")
}
