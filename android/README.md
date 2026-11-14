# VVVion Space Android hybrid (3.0.1)

This directory is reserved for the native Android hybrid shell.

## Source import
Copy the **contents** of the `project/` directory from `vvvion-space-3.0.1-hybrid-android-next.zip` into this `android/` directory (not the outer `project` folder). Preserve binary files including `gradle/wrapper/gradle-wrapper.jar` and `app/src/main/assets/`. Do not copy `project/.github/` into `android/`: the repository workflow is at `.github/workflows/android-hybrid.yml`.

The repository workflow runs `cd android && ./gradlew :app:assembleDebug` on pushes to `android-hybrid-3.0.1` affecting Android files, pull requests, or manual dispatch. Download the resulting debug APK from the run's Artifacts section.

The package name is `space.vvvion.app`; versionCode 17 and versionName 3.0.1. Debug APKs are signed with a debug key and **cannot** be installed as updates to an existing release-signed app without uninstalling it. Do not uninstall before backing up any local app data.

Never commit release signing credentials, `local.properties`, or `app/google-services.json`. The Firebase integration is optional in this source tree.

The Android sources must be imported from the prepared archive before the workflow can build an APK. A workflow run before importing them is expected to fail at the source-tree check.
