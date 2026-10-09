# Status prac Inventory Generator

Stan koordynatora: **9 października 2026**. Kod, wdrożenie i wykonane testy są
rozróżnione; nie jest to deklaracja ukończenia całego standardu platformy.

## Kod i produkcja

PR-y [#26](https://github.com/SzczepanGrela/inventory-generator/pull/26),
[#27](https://github.com/SzczepanGrela/inventory-generator/pull/27) i
[#28](https://github.com/SzczepanGrela/inventory-generator/pull/28) zostały scalone.
Połączona rewizja `697149654f7f84dfe8aabe3565838348ef3a8220` przeszła chronione
wdrożenie [37574806859](https://github.com/SzczepanGrela/inventory-generator/actions/runs/37574806859).
Jej CI obejmowało 84 testy .NET, 34 Python i 12 zestawów przeglądarkowych,
kwalifikację końcowego obrazu i kontrolę publicznej rewizji.

PR [#29](https://github.com/SzczepanGrela/inventory-generator/pull/29) dodał
narzędzia odbioru (`d62e2dc`). Kontrolowany rollback 9 października przywrócił
produkcję do dokładnego wcześniejszego obrazu i rewizji `6971496`. Ostatnie
ukończone próby publiczne nadal potwierdzały tę rewizję. Przygotowanie niniejszego
PR-u sprzątającego nie jest nowym wdrożeniem produkcyjnym.

## Przyjęte zmiany i testy

- Jedna wersjonowana koperta `inventory_project`, bezpieczna migracja legacy,
  zachowanie oryginału po błędzie zapisu i dokładny surowy projekt w recovery.
  Poprawki PL/EN i dostępności są zintegrowane; #26/#27 nie oczekują już na review.
- DOCX używa `OpenXmlWriter` z buforowaniem w `MemoryStream`, nie bezpośredniego
  strumieniowania odpowiedzi. Limiter zachowuje trzy sloty bez kolejki,
  ograniczenia wejścia i natychmiastowe 429 z Retry-After.
- Ograniczone logi reason-code i rzeczywiste regresje .NET/Python/przeglądarki;
  testy procedur wykonują kod wyodrębniony z workflowu i runbooka.
- Lokalne testy HTTP dokładnego obrazu pod 1 CPU/512 MiB: 38 + 59 żądań,
  najgorszy odczyt memory.peak 469,61 MiB. To nie eliminuje ryzyka OOM.
- Publiczna izolacja klientów, retry/recovery i próby podrobienia nagłówków
  przyjęte 8 października. Odrzucenie niezdrowego canary i kontrolowany
  failed-smoke rollback przyjęte 9 października.
- Końcowy ograniczony test rolling 9 października: osiem poprawnych struktur
  CSV/HTML/DOCX, normalne SIGTERM/exit 0 starej instancji, zdrowa nowa instancja,
  po 51 poprawnych prób zdrowia obu publicznych aplikacji i brak przekroczenia
  warunków zatrzymania. Szczegóły i granice: [zapis odbioru](operational-acceptance.md).

## Pozostała praca

D02.3a/b/c/d są przyjęte w prywatnej dokumentacji koordynatora. D02.3e/f pozostają
otwarte na sprzątanie i końcową synchronizację dowodów. Ten PR usuwa tymczasowy
workflow ćwiczeń, moduły i hak wymuszający błąd; zwykły release/rollback oraz jego
testy pozostają. Scalanie PR-u i usunięcie zasobów Coolify to osobne czynności.

Trzeba zachować logi prób, usunąć wyłącznie zidentyfikowane zasoby testowe i
potwierdzić ich brak. Nie potrzeba kolejnego testu obciążenia dla przyjętego zakresu.
Nadal osobno śledzone są centralny monitoring/alerty, wyjątki parsera hardeningu,
zakres poświadczeń, izolacja edge w tej samej lokalizacji i szersze odzyskiwanie.
Jedno wcześniejsze ostrzeżenie runnera przy rollbacku pozostaje niewyjaśnione;
nie deklarujemy gwarancji zerowego downtime ani ukończenia całej roadmapy.
