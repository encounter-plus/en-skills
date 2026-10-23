---
name: level-script
description: Написать или исправить авторский JavaScript Encounter для выбранного modern/Kotlin или legacy/React Native профиля и проверить его фактическое поведение.
---

# Скрипт уровня

1. Получите механику, target от host, surface gameplay/announcement и clients. Прочитайте [общие правила](../../knowledge/scripting/common.md) и [приоритет экранов](../../knowledge/author-ui-policy.md). При неизвестной цели подготовьте независимую часть; интеграция требует известного target.
2. Для modern browser читайте [modern](../../knowledge/scripting/modern.md), для modern EN+ — также [Kotlin](../../knowledge/scripting/modern-enplus-kotlin.md). Для legacy browser читайте [legacy browser](../../knowledge/scripting/legacy-browser.md), для legacy EN+ — также [RN](../../knowledge/scripting/legacy-enplus-react-native.md). Загружайте выбранные references. Подтвердите точные API, DOM и lifecycle; без контракта перечислите недостающие сведения.
3. Реализуйте минимальную механику с собственным root, идемпотентной инициализацией и cleanup. Для поля ответа прочитайте [ФО](../../knowledge/answer-formats.md). Зависимости укажите явно. Сохраняйте буквальное содержимое и строки; widget core отделяйте от окружения, когда это упрощает код.
4. Прочитайте [стенд](../../knowledge/script-harness.md) и [матрицу доказательств](../../knowledge/scripting/validation.md). Выберите snapshot/driver по runtimeProfile. Выполните синтетические scenarios механики, inspect errors, DOM и число отправок. Для живого сохранённого preview используйте соответствующий движку маршрут и предоставленный контроллер. Административная публикация — отдельная операция.
5. Отдайте HTML/JS, место установки, зависимости, реальные результаты и непроверенные клиенты/scenarios. Chromium success не доказывает Android device success. Завершение: артефакт воспроизводим, использованные API подтверждены, ограничения перечислены.

По оформлению: [визуальные правила](../../knowledge/visual-design.md). Для Bonus Help и preview: [сценарий проверки](../../knowledge/scripts-and-preview.md). Reference не предоставляет отсутствующий инструмент.

Подготовка завершена воспроизводимым артефактом и сценарием проверки. Проверка завершена результатами каждого доступного целевого окружения; недоступное окружение остаётся непроверенным, даже если статический анализ успешен.
