plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.smartphotos.s0"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.smartphotos.s0"
        minSdk = 24
        // The Fire HD 10 (9th gen) runs Android 9 (API 28).
        targetSdk = 28
        versionCode = 1
        versionName = "0.1"
        // The tablet is 32-bit only (armeabi-v7a); there is nothing else to ship.
        ndk { abiFilters += listOf("armeabi-v7a") }
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
    androidResources { noCompress += "onnx" }
}

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.31.1")
}
