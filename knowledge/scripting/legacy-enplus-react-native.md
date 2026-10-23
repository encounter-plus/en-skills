# Legacy EN+ React Native

Используйте legacy-enplus-react-native snapshot из RN src/components/game/unified-webview. Реальные buildGameHtml/buildInjectedJs, vendored jQuery 1.6.2 и command builders включаются в portable snapshot. Kotlin webview-runtime и androidApp CSS не являются RN источниками.

Snapshot также экспортирует реальные serializers и buildLevelTaskHtml. Их i18n host синтетический: language=ru, labels возвращают resource keys. Manifest явно фиксирует эту подмену; это не проверка перевода приложения.

RN создаёт совместимый DOM секций, а не копию всего сайта. window.EN отсутствует. window.__enplus — приватная host boundary, не публичное API автора. Для нового кода применяйте [общие правила JavaScript](common.md); интеграция использует подтверждённые DOM-формы и JSON proxy. jQuery-зависимости готовых внешних скриптов проверяйте по [legacy browser](legacy-browser.md). Не изобретайте admin endpoints. Форма/поле Answer и engineAside зависят от данных профиля.

Runtime выполняет Task/Help/Message scripts, упорядочивает blocking dependencies, обрабатывает updates. ready/load handlers могут запросить полную пересборку документа. После rebuild closures сброшены, localStorage восстанавливается из host seed до author scripts. Различайте bridgeReady, contentReady и ready. Отдельный injected fallback должен быть idempotent. Проверяйте текущий snapshot: старый research inline-escaping дефект мог быть исправлен в исходниках.

Fake host отвечает на answerCodeSubmit, engineJsonRequest и engineAnswerSubmit; proxy ожидает engineJson fixture и использует реальные resolve/rejectEngineJsonRequest. Это моделирование native host, а не игровой сервер. authorLifecycleRefreshRequest/authorReload фиксируются отдельно; сам факт запроса ещё не доказывает remount. Regression tool отдельно пересоздаёт document с storage seed и проверяет сброс closure. Device timing и native navigation требуют Android проверки.


## Renderer DTO для shared update

Это формы реального RN renderer, не authoring API JSON. Строки HTML передаются буквально. `update.hints.data` имеет `{hints:[...],penaltyHints:[...]}`; остальные секции кроме task принимают массив.

| Секция | Поля элемента |
|---|---|
| messages | id, owner, html; ownerId optional; hasScript:true если HTML содержит script |
| hints | id, number, text (string/null), textHasScript optional, remainSeconds, isPenalty:false |
| penaltyHints | id, number, text, remainSeconds, isPenalty:true, penalty, penaltyComment, state (0 closed/1 opened) |
| sectors | id, order, name (string/null), isAnswered, answer |
| bonuses | id, number, name, task, taskCopyText, taskHasScript, help, helpCopyText, helpHasScript, expired, secondsToStart, secondsLeft, awardTime, negative, fromEarlierLevel, isAnswered, answer |

Для открытого sector/bonus `isAnswered:false, answer:null`; для закрытого `isAnswered:true, answer:{code,login,time}`. Реальный serializer убирает scripts завершённого Bonus.Task и открывает Help только при подтверждённом Answer record. Не включайте старый исполняемый Bonus.Task вручную в answered update. Проверенный synthetic пример находится в packaged harness/scenario-react-native.json. Counts action/refresh относятся к текущему document; JSON GET proxy также отправляет host message.
