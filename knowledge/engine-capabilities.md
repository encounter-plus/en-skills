# Цель и возможности движка

Перед авторским workflow получите immutable host scope: domain/game, engine, session и capabilities. Registry выбирает demo.en.cx → modern/Kotlin, остальные разрешённые Encounter tenants → legacy/RN. Неподдерживаемый hostname или ошибка запроса не являются разрешением выбрать другой adapter. У неизвестной цели готовьте независимый черновик, затем уточните target до интеграции.

Используйте только объявленные host операции. Одинаковые JSON paths/DTO facade не означают одинаковые гарантии backend. Проверяйте capability и completeness отдельно для чтения и записи. supported относится к конкретной операции и её доказанной семантике; unverified/unsupported не заменяются guessed form fields, пустыми значениями или произвольным HTTP.

Modern SDK endpoints, base_version/CAS, статусы 409/207 и multipart описывают modern adapter. Legacy использует подтверждённые HTML/form recipes, observed revision и read-back; не выдумывайте server CAS или version=0. Before snapshot должен быть полный. Unknown write требует reconciliation без повторной записи.

## Анонс, «Важно» и poster

«Важно» — отдельный блок modern движка; это не произвольный текст HTML-анонса. Проверяйте отдельную capability и точное поле до чтения/правки. На legacy отдельное соответствующее поле не подтверждено: помечайте unsupported/unverified и не записывайте его в Descr, from_author_text или похожее control по догадке. Работа с подтверждённым описанием игры остаётся отдельной операцией.

Poster и HTML-анонс — разные артефакты. Генерация/подготовка poster.png не означает upload или выбор poster в игре. Для legacy не переносите modern POST /admin/games/{id}/files, poster_url или multipart контракт автоматически. До подтверждения host capability и read-back оставляйте poster готовым локальным артефактом с инструкцией; не заявляйте публикацию. Поддержанное modern чтение/загрузка также требует отдельной проверки назначения poster.

Для player scripts используйте [runtime selection](scripting/common.md). Наличие authoring adapter не доказывает наличие window.EN в gameplay или announcement.
