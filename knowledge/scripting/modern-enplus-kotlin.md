# Modern EN+ Kotlin

Для demo.en.cx используйте профиль modern-enplus-kotlin, Kotlin renderer/runtime и snapshot с framework=kotlin, engine=modern. [Modern контракт](modern.md) обязателен. Snapshot из RN не подходит. Manifest фиксирует source revision, dirty flag, input hashes и output hashes; проверка отклоняет несовпадение до выполнения renderer. Native bridge и responses синтетические. Chromium не сертифицирует Android WebView, IME, background/recovery и native controls.
