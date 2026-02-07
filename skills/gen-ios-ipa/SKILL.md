---
name: gen-ios-ipa
version: 1.0.0
description: Generate an unsigned IPA in designated directory for a Pistachio project.
license: Complete terms in LICENSE.txt
---
1. Find out project_dir (pwd + / + {PISTACHIO_PROJECT_NAME}), app_name in iosApp/Configuration/Config.xcconfig and export_path (where to put the ipa).
2. Run npx tsx genIpaUnsigned.ts <project_dir> <app_name> [export_path]
