# Research Lab — краткая записка для бизнеса

**Что это.** Инструмент, который из темы/запроса собирает структурированный
research-отчёт с цитатами на первоисточники и отдельной колонкой «проверено /
не проверено» на каждом факте. В отличие от обычных AI-чатов, он не пишет
«убедительный текст», а строит reproducible audit trail: откуда каждое
утверждение, какой verdict'ом его пометил трёхслойный проверяльщик, какие
пробелы в evidence.

**Для кого.** R&D, продуктовые команды, R&D в R&D (научные отделы в
фарме/косметике/ML), инвест-команды которые читают 50 пейперов в неделю,
патентные команды — любой кейс где «LLM сочинил красивый ответ» не годится,
нужен источник каждой цифры.

## Как работает pipeline

Каждый «research project» проходит через 7 фаз:

1. **Scout** — быстрый лит-обзор темы, калибрует что вообще есть в поле.
2. **Plan** — планировщик режет тему на 3–12 исследовательских вопросов, каждый с 2-4 подвопросами (6 категорий × 6 углов атаки). Никаких выдуманных цифр и гипотез вперёд — вопросы такие, на которые источники *могут* ответить.
3. **Harvest** — по каждому подвопросу параллельно: SearXNG + Arxiv + OpenAlex + Semantic Scholar, Playwright тянет full-text (а не сниппеты), deep-recursion breadth×depth.
4. **Evidence** — извлекает факты с привязкой к *exact quote* в источнике. Каждый факт: `{statement, factuality, confidence, references:[{url, title, exact_quote}]}`.
5. **Verify** — трёхслойная проверка каждого факта:
   - L1: HEAD на URL (живой ли?)
   - L2: substring match цитаты в скрэпнутом тексте (не выдумали?)
   - L3: LLM-adversarial review (накрывает ли цитата реально то что утверждает факт, или overreach/misread/cherry-pick?)
6. **Analyze** — по каждому вопросу narrative-ответ из *только верифицированных* фактов + coverage-статус (complete/partial/gaps_critical/insufficient) + кросс-вопросные противоречия.
7. **Synth** — итоговый REPORT.md с citations inline (`[F42]`), PDF-экспорт.

Отклонённые верификатором факты в итоговый отчёт не попадают вообще.

## Фича pre-research clarifying chat

Перед запуском юзер может нажать «Discuss scope» — короткий чат с LLM
который задаёт 1–3 уточняющих вопроса (домен, scope, angle), потом
показывает **структурированный бриф**: переформулированная тема + domain
hints + constraints + превью 3–6 исследовательских вопросов. Юзер видит
что именно будут исследовать, нажимает «Run research» → бриф
прокидывается в pipeline и все запросы harvester'а пинятся к домену (не
ловят физ-химию titanium'а когда речь про косметический TiO₂).

## Текущий deploy

- **URL:** http://156.67.28.41:3000 (HTTP, без домена — для продакшена нужен
  TLS-proxy, добавляем когда будет домен).
- **Стек:** Next.js 16 (web + REST API), Docker-out-of-docker для спавна
  pipeline-контейнеров, SearXNG self-hosted, LLM на Runpod (qwen3.6-35b-a3b).
- **Auth:** email/password (scrypt N=16384), HMAC-signed session cookies,
  scoped API keys для программных интеграций (per-user ownership).
- **Isolation:** каждый юзер видит только свои проекты. Проекты владельца-
  админа доступны как showcase публично; остальные приватные.
- **Webhooks:** `run.completed` / `run.failed` POST-ится на URL юзера с
  HMAC-подписью и ссылками на артефакты (report, facts, analysis, pdf).
  Retry 3× с экспоненциальным backoff, терминальные фейлы логируются.

## Что уже реально работает на проде

- Signup/login, per-user приватные проекты
- Public landing + showcase research (KV-cache compression demo) без
  регистрации
- Pre-research scope chat → брифинг → запуск
- 7-фазный pipeline с budget caps (`MAX_HARVEST_MINUTES=40` default)
- 3-layer verifier: URL → keyword → LLM adversarial
- Evidence attribution check (отсев фактов, где primary named entity не
  встречается в цитируемом источнике)
- Relevance gate (новая фаза между harvest и evidence — отсев off-domain
  источников до извлечения фактов)
- PDF-экспорт через Playwright
- Kill run кнопка (убивает spawned pipeline container)
- Delete project (owner или admin)
- REST API с полным OpenAPI 3.1 spec'ом (21 endpoint)
- Admin dashboard с live stats (users / projects / runs / keys)
- 142 unit-теста через `bun test`

## Что в работе / следующие шаги

- **Новый UI** дизайн (дропнули вчера HTML mockup'ы, сейчас в процессе
  порта под реальные компоненты — dashboard уже на warm-палитре в стиле
  Claude, остальное подтянется в течение ближайших часов).
- **Domain seed whitelist** — для известных доменов (косметика/дерматология
  уже на проде через брифинг-чат) подмешивать в harvester domain-specific
  сайты.
- **Fact dedup через embeddings** — сейчас dedup'аем по first-120-chars, это
  иногда пропускает парафразы.
- **Share tokens** — публичный URL для одного приватного проекта
  (полезно для шаринга research с командой без полного onboarding'а).
- **Browser push / email notifications** на run-completion (email'ы
  подключим когда будет smtp-relay или SES).

## Как попробовать самому

1. Открыть http://156.67.28.41:3000
2. Signup (открыт)
3. На dashboard ввести тему или нажать на один из пресетов (KV-cache /
   Cosmetic formulation / Battery longevity / LLM fine-tuning)
4. Нажать **Discuss scope** → ответить на 1-2 вопроса чатбота → Run
5. Run занимает 30–60 мин в среднем, можно закрыть вкладку, результат
   окажется в Projects когда закончится. Если настроен webhook — POST'нется
   callback.

## Интеграция с внешним приложением

```
GET    /api/openapi.json                 # полный spec
GET    /api/projects                     # список своих (с X-API-Key)
GET    /api/projects/{slug}              # полный bundle
GET    /api/projects/{slug}/facts        # facts с verification
GET    /api/projects/{slug}/report       # REPORT.md как text/markdown
POST   /api/runs/start                   # запустить новый run
GET    /api/runs/stream?id=<runId>       # SSE лог stream
```

API key генерится в Settings, scope'ится к пользователю который его создал
(консумер-приложение с твоим ключом читает твои проекты, не чужие).

---

Дата: 2026-04-20. Версия: 0.3.0.
