---
name: Frontend App Location
description: Location and purpose of the paycycle_vendor frontend project that agents should reference
metadata:
  type: reference
---
The frontend app project is at: `D:\Shrihari\Sourcecode\personal\paycycle\paycycle_vendor`

This is the React Native (Expo + TypeScript) mobile app for PayCycle. Backend agents should reference it for:
- Screen flows and expected API response shapes
- Offline-first behavior — backend must support WatermelonDB sync patterns
- Auth flow — Mobile Number + Password (not email-based)
- Tamagui component data contracts and i18n key alignment
- Feature requirements that drive endpoint design
