# Шаблон задания

Исходный HTML для адаптации под задание; проверяется в фактическом preview.

```html
<section class="en-task" data-en-task>
  <header class="en-task__header">
    <p class="en-task__eyebrow">Этап 1</p>
    <h2 class="en-task__title">Короткое название задания</h2>
  </header>

  <div class="en-task__body">
    <p>Что нужно сделать и какой результат получить.</p>
    <ol>
      <li>Первый проверяемый шаг.</li>
      <li>Второй проверяемый шаг.</li>
    </ol>
  </div>

  <aside class="en-task__rules" aria-label="Формат ответа">
    <strong>Формат ответа:</strong> EN1234. Нужно получить 3 кода.
  </aside>
</section>

<style>
  .en-task {
    box-sizing: border-box;
    max-width: 48rem;
    margin: 0 auto;
    padding: clamp(1rem, 3vw, 1.5rem);
    color: #f5f7f8;
    background: #15191c;
    border: 1px solid #43505a;
    border-radius: 0.75rem;
    line-height: 1.55;
  }

  .en-task *,
  .en-task *::before,
  .en-task *::after {
    box-sizing: inherit;
  }

  .en-task__eyebrow {
    margin: 0 0 0.25rem;
    color: #a8d9b0;
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .en-task__title {
    margin: 0 0 1rem;
    font-size: clamp(1.35rem, 5vw, 2rem);
    line-height: 1.2;
  }

  .en-task img,
  .en-task video {
    display: block;
    max-width: 100%;
    height: auto;
  }

  .en-task__rules {
    margin-top: 1.25rem;
    padding: 0.875rem 1rem;
    color: #ffffff;
    background: #24382a;
    border-left: 0.25rem solid #70c27c;
  }

  @media (max-width: 32rem) {
    .en-task {
      border-radius: 0.5rem;
    }
  }
</style>

```
