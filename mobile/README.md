# Filey for Android and iOS

These Capacitor projects package the full responsive app from the repository
root. The desktop, web and phone apps use the same React routes and business
logic. Run every command below from the repository root; there is one npm
manifest and lockfile.

## Android

Install Node 22.13 or newer, JDK 21 and Android Studio 2024.2.1 or newer.
The checked-in Gradle wrapper uses Gradle 8.11.1 and Android Gradle Plugin
8.7.2. Install Android SDK platform 35, build-tools 34.0.0 and platform-tools.
Set `JAVA_HOME` to JDK 21 and `ANDROID_HOME` to the SDK directory.

```sh
npm ci
npm run build:android
```

The installable debug APK is
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`. To work in Android
Studio, run `npm run cap:android`. Debug APKs use the SDK's debug signing key;
production distribution requires your own release signing configuration.

## iOS

Use a Mac with Xcode 16 or newer and its command-line tools. Dependencies use
Swift Package Manager, so CocoaPods is unnecessary. The CI build selects
Xcode 16.4 on `macos-15`.

```sh
npm ci
npm run build:ios
```

The unsigned simulator app is
`mobile/ios/build/Build/Products/Debug-iphonesimulator/App.app`. Install it in
an available simulator with `xcrun simctl install booted <path-to-App.app>`.
Run `npm run cap:ios` to open the project in Xcode for device testing. A device
or App Store build needs an Apple team, signing certificate and provisioning
profile; the simulator build needs none of those.

## CI and native configuration

`.github/workflows/mobile.yml` builds Android and iOS separately on relevant
pushes to `codex/mobile-apps` or `main`, pull requests and manual runs. Download
`filey-android-debug-apk` or `filey-ios-simulator-app` from the workflow's
artifacts. The iOS artifact is a simulator `.app` ZIP, not an iPhone IPA.
The `filey-android-smoke` and `filey-ios-smoke` artifacts contain launch and
relaunch screenshots plus diagnostics from fresh emulators; no account or
customer actions run during those checks.

`capacitor.config.ts` sets the bundle ID to `com.filey.app`, app name to Filey
and web directory to the root `dist`. Native sources, manifests and icons
are tracked; generated web assets, build output, SDK paths and signing files
are ignored. Run `npm run cap:sync` after web or plugin changes. The mobile
version is 3.0.9 with build number 1; desktop release versioning is separate.
The update hook keeps generated Swift package paths portable when syncing on
Windows.

The native projects register `filey://app/...` for validated app deep links.
HTTPS association for `app.gofiley.com` is not configured. iOS includes the
Preferences and Filesystem privacy reasons. Launcher and splash art use
`public/icons/filey-ios-v2.png` and `src-tauri/icons/icon.png`.
