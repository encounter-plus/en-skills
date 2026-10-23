# Legacy browser gameplay

Для нового кода применяйте [общие правила JavaScript](common.md). В проверенном legacy gameplay runtime есть jQuery 1.6.2; готовый внешний скрипт с этой зависимостью должен использовать методы этой версии: .on/.off появились позже и не подходят. window.EN не является legacy API.

Preview имеет вид /admin/games/levels/preview/{gameId}?level={number}; modern route не подставляется. Полный DOM, selectors и формы сверяйте с конкретной страницей. Live player answer verdicts и полный lifecycle пока unverified: наличие jQuery и контейнера не доказывает поведение отправки. Unknown outcome не повторяется автоматически.
