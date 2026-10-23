# Доказательства и ограничения

Static syntax проверяет только компиляцию. Synthetic DOM проверяет выбранные selectors. Профиль EN+ проверяет настоящий snapshot runtime с fake native host; live preview проверяет текущий сохранённый документ сайта; device отдельно проверяет WebView/IME/focus/background/recovery. Эти результаты не заменяют друг друга.

Для каждой заявленной механики проверяйте bootstrap, dependency order/error, Task/Hint/Message scripts, Bonus Help → изменение Task/картинки с буквальным HTML, update и lifecycle rebuild, storage seed, одиночную отправку и stale replies. Список требований не означает реализованное покрытие: в отчёте перечисляйте исполненные scenarios. Сеть закрыта, dependencies — локальные fixtures. Результат dependency error не считается успешной загрузкой. modern/RN и legacy/Kotlin отклоняются до выполнения.
