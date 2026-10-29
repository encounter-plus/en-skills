# Сборки en-skills для GitHub Releases

Описание выпуска: [en-skills 0.0.1](releases/0.0.1.md). Готовые архивы сохраняются в локальном `release-output/`, исключённом из Git; их прикладывают к выпуску отдельно.

Команды ниже выполняются в PowerShell из корня en-skills. Нужны Node.js 24+ и npm. Это подготовка файлов; публикация выполняется отдельно.

## Версия и проверки

Прочитайте [VERSIONING.md](../VERSIONING.md). Перед распространением изменённых скилов, справочников или инструментов обновите версию в `package.json` и соответствующие записи `package-lock.json`. Изменение только документации для разработчика не требует повышения. Не заменяйте опубликованный архив другими байтами под той же версией.

```powershell
npm ci
npm run check
npm run test:package
```

При ошибке любой команды остановитесь и исправьте её до упаковки. `check` собирает `dist/skills`, проверяет все скиллы и ссылки внутри поставки.

## ZIP для установки скилов

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force release-output | Out-Null
$archive = "release-output/en-skills-$version.zip"
Compress-Archive -Path dist/skills/* -DestinationPath $archive
(Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLower() + "  en-skills-$version.zip" | Set-Content -Encoding ascii "$archive.sha256"
```

В корне ZIP находятся папки скилов вместе со справочниками и скриптами. После распаковки копируйте целые папки в каталог скиллов своего приложения по [инструкции установки](install.md). Не используйте автоматически созданный GitHub архив **Source code** как готовый набор для копирования: там исходники, требующие сборки.

## npm-пакет для интеграций

```powershell
npm pack --pack-destination release-output
```

Команда запускает `prepack` и создаёт `.tgz` с библиотекой, CLI и скиллами. Это пакет для встраивания инструментов в приложения. Команда ничего не публикует в npm; пакет отмечен `private`.

## Что приложить к выпуску

Создайте GitHub Release для выбранного коммита/тега и приложите ZIP, его `.sha256` и, если нужен интеграторам, `.tgz` из `release-output/`. В описании укажите версию, изменения, требования Node.js для инструментов и ссылку на установку. Для предварительного выпуска используйте prerelease.
