# Procedury Operatorskie Inventory Generator (Operator Runbook)

Dokument określa procedury weryfikacji wydania, wycofania (rollback), inspekcji środowiska uruchomieniowego (*effective-runtime readback*) oraz protokół pomiaru nakładania się kontenerów (*rolling overlap*) na współdzielonym serwerze VPS.

Zgodnie z decyzją architektoniczną `docs/decisions/2026-10-03-inventory-process-local-limits.md` (w prywatnym repozytorium infrastruktury `SzczepanGrela/grela-dev-infrastructure`) oraz wytycznymi koordynatora, **wszelkie testy obciążeniowe i awaryjne na współdzielonym VPS wymagają skoordynowanego okna operacyjnego, aktywnych progów zatrzymania (stop thresholds) oraz zapisanego stabilnego wydania bazowego**.

---

## 1. Odrzucenie Kandydata (Candidate Rejection)

Przed wdrożeniem lub w trakcie weryfikacji przedwdrożeniowej operator weryfikuje integralność artefaktu i zgodność ze specyfikacją Coolify. Kandydat zostaje bezwzględnie **odrzucony**, jeśli nie spełnia któregokolwiek z poniższych warunków.

### Kryteria odrzucenia:
1. **Niezgodność skrótu (Digest Mismatch)**: Obraz nie jest przypięty unikalnym skrótem `sha256:...`.
2. **Brak lub negatywna atestacja SLSA/Provenance**: Atestacja GitHub Actions nie weryfikuje się pomyślnie.
3. **Dryf konfiguracji Coolify (Configuration Drift)**: Rzeczywista konfiguracja zasobu w Coolify różni się od kontraktu `infra/coolify-production.json` (np. limit RAM > 512 MiB, CPU > 1.0, porty, zmienne środowiskowe).
4. **Podatności wysokiego ryzyka**: Skaner Trivy (z flagą `ignore-unfixed: true` skonfigurowaną w CI) wykrywa podatności wysokiego lub krytycznego ryzyka z dostępną poprawką (*fixable HIGH/CRITICAL*).

### Procedura weryfikacji kandydata przez operatora:

```bash
# 1. Weryfikacja atestacji GitHub CLI dla digestu
gh attestation verify oci://ghcr.io/szczepangrela/inventory-generator@sha256:<DIGEST> \
  --owner SzczepanGrela

# 2. Weryfikacja zgodności konfiguracji z kontraktem Coolify (bez mutacji stanu)
python3 -c '
from pathlib import Path
from infra.coolify_release import CoolifyClient, load_contract, verify_application, token_from_environment

client = CoolifyClient("https://coolify.internal.grela.dev", token_from_environment())
contract = load_contract(Path("infra/coolify-production.json"))
app = client.get_application("<APPLICATION_UUID>")
verify_application(app, contract, "<APPLICATION_UUID>", require_healthy=True)
print("Kontrakt Coolify zgodny, produkcja zdrowa.")
'
```

W przypadku wykrycia niezgodności operator odrzuca wdrożenie w GitHub Actions (odrzucenie środowiska `production` w runie workflow) lub usuwa kandydata z kolejki.

---

## 2. Wycofanie po Nieudanych Testach Dymnych (Failed-Smoke Rollback)

Mechanizm wycofania (*rollback*) zapewnia przywrócenie poprzedniej znanej, stabilnej wersji w przypadku niepowodzenia wdrożenia. Należy ściśle odróżnić **standardową promocję wydania** (`deploy_release`) od **awaryjnego wycofania** (`rollback`):
- **Standardowa promocja (`deploy_release`)**: obejmuje weryfikację kontraktu, odpytywanie wdrożenia Coolify (budżet `--deployment-timeout`, domyślnie 600s), ustabilizowanie nowej rewizji (do 45 prób co 2s na 5 kolejnych zgodnych odczytów), sprawdzenie stanu `running:healthy`, pełne testy dymne (`infra.smokecheck.check_release`) oraz minimum 30-sekundowe okno obserwacyjne (*soak period*: 15 sprawdzeń co 2s przez `soak_release`).
- **Awaryjny rollback (`rollback`)**: nie jest procesem natychmiastowym, lecz celowo pomija fazę `soak_release`, aby zminimalizować czas przywrócenia stabilnej usługi. Składa się z odrębnych faz o zdefiniowanych parametrach i limitach prób:
  1. Sprawdzenie braku aktywnych i niepewnych wdrożeń (`verify_no_running_deployment`).
  2. Przywrócenie poprzedniego tagu obrazu w Coolify (`client.update_tag`) i weryfikacja kontraktu.
  3. Kolejkowanie wdrożenia i odpytywanie jego statusu (budżet `--deployment-timeout`, domyślnie 300s/600s, z równoległą sondą publiczną i natychmiastowym anulowaniem do 60s przy 3 kolejnych błędach).
  4. Oczekiwanie na ustabilizowanie się poprzedniej rewizji publicznej: do 30 prób co 2s na 3 kolejne zgodne odczyty przez `wait_for_revision` (pojedyncze żądanie sieciowe z 10s timeoutem w `read_public_revision`; przy szybkiej stabilizacji zwraca natychmiast po 3 zgodnych odczytach).
  5. Oczekiwanie na stan zdrowia kontenera w Coolify: do 30 prób co 2s przez `wait_for_healthy_application`. Klient `CoolifyClient` domyślnie stosuje 15-sekundowy timeout pojedynczego wywołania oraz do 3 prób GET z przerwami backoff (1s, 2s) przy błędach sieciowych lub HTTP >= 500; przy poprawnym statusie kontenera (`running:healthy`) funkcja powraca natychmiast bez oczekiwania na wyczerpanie prób.
  6. Weryfikacja bazowego endpointu zdrowia (`check_public_baseline`).

### 2.1. Automatyczny Rollback w `coolify_release.py`
Wbudowany skrypt wdrożeniowy automatycznie wycofuje zmiany w przypadku:
- Przekroczenia limitu czasu wdrożenia kandydata w Coolify (`--deployment-timeout`).
- 3 kolejnych nieudanych prób odpytania publicznego endpointu zdrowia w trakcie wdrażania (`monitor.consecutive_failures >= 3`).
- Niepowodzenia testów dymnych `infra.smokecheck.check_release` po przełączeniu ruchu.
- Braku ustabilizowania się nowej rewizji w oknie obserwacyjnym (*soak period*).

Skrypt automatycznie przywraca poprzedni tag obrazu (`previous_tag`), weryfikuje stan `running:healthy` oraz sprawdza endpoint `/api/health` dla poprzedniej rewizji `previous_revision`.

### 2.2. Procedura Manualnego Rollbacku przez Operatora
Jeżeli automatyczny proces zawiedzie lub wymagane jest ręczne wycofanie wersji produkcyjnej, operator dysponuje dwoma ścieżkami:

#### Opcja A (Zalecana i Podstawowa): Serializowane Wycofanie przez GitHub Actions
Jest to **rekomendowana i bezpieczna ścieżka**. Workflow `deploy.yml` korzysta z grupy współbieżności `concurrency: group: production, cancel-in-progress: false`, co zapobiega równoległym wdrożeniom i wyścigom promocji, a także egzekwuje bramki środowiskowe `production` (wymóg manualnego zatwierdzenia przez operatora przed wejściem do fazy produkcyjnej):

```bash
# Weryfikacja etykiety rewizji w obrazie przed wywołaniem (opcjonalnie z poziomu CLI)
gh attestation verify oci://ghcr.io/szczepangrela/inventory-generator@sha256:<PREVIOUS_STABLE_DIGEST> \
  --repo SzczepanGrela/inventory-generator

# Wywołanie workflow z przekazaniem digestu oraz docelowej rewizji
gh workflow run deploy.yml \
  --ref main \
  -f digest="sha256:<PREVIOUS_STABLE_DIGEST>" \
  -f expected_revision="<PREVIOUS_STABLE_COMMIT_SHA>"
```

**Weryfikacja i obsługa bramki świeżości (freshness gate):**
- Krok preflight weryfikuje atestację SLSA oraz zgodność etykiety `org.opencontainers.image.revision` z podaną wartością `expected_revision`. W razie niezgodności proces kończy się natychmiastowym błędem.
- Bramka świeżości (`freshness`) rozróżnia automatyczne wywołania (`workflow_call` – gdzie niezgodność `main_revision != EXPECTED_REVISION` oznacza nieaktualny build i pomija wdrożenie `deploy=false`) od celowych, manualnych dyspozycji operatora (`workflow_dispatch`). Przy manualnym wywołaniu zamierzony powrót do starszej rewizji nie jest pomijany jako stale (`deploy=true`), przy pełnym zachowaniu weryfikacji etykiety i blokady współbieżności `concurrency: production`.
- Alternatywnie operator może pominąć parametr `expected_revision` (pozostawiając wartość domyślną pustą), co spowoduje odczytanie i weryfikację docelowej rewizji bezpośrednio ze zweryfikowanej etykiety kontenera w kroku preflight.

#### Opcja B (Awaryjna Interwencja Bezpośrednia): Coolify API przy Zamrożeniu Promocji
W sytuacji całkowitej awarii lub niedostępności GitHub Actions operator może wykonać rollback bezpośrednio przez Coolify API.

> [!CAUTION]
> **UWAGA DOTYCZĄCA WSPÓŁBIEŻNOŚCI I BRAKU BLOKADY:**
> Sam odczyt historii wdrożeń z Coolify API (`verify_no_running_deployment`) **NIE** stanowi blokady (locka) ani serializacji wydań. Trwający workflow GitHub Actions może oczekiwać na zatwierdzenie środowiskowe (manual approval) lub preflight zanim pojawi się wpis w Coolify. Z tego względu bezpośrednia interwencja wymaga skoordynowanego zamrożenia wdrożeń (*operational promotional freeze*) – operator musi jawnie potwierdzić wyłączność (brak równoległych pipeline'ów CI, brak innych operatorów) przez **całe okno operacji**.

Przed wykonaniem mutacji operator **musi** potwierdzić, że wszystkie wcześniejsze wdrożenia osiągnęły stan terminalny (`finished`, `failed`, `cancelled`). W razie wykrycia aktywnego wdrożenia (`queued`, `in_progress`) należy je anulować i poczekać na zakończenie. W razie stanu nieznanego (*uncertain*) – **zatrzymać się i zbadać przyczynę w Coolify**, nigdy nie kolejkować drugiego wdrożenia w ciemno.

```bash
python3 -c '
import sys
from pathlib import Path
from infra.coolify_release import (
    CoolifyClient, load_contract, rollback, verify_application,
    verify_no_running_deployment, token_from_environment,
    ReleaseError, UncertainDeployment
)

client = CoolifyClient("https://coolify.internal.grela.dev", token_from_environment())
contract = load_contract(Path("infra/coolify-production.json"))
app_uuid = "<APPLICATION_UUID>"

# 1. Sprawdzenie stanu istniejących wdrożeń (ochrona przed wyścigiem)
print("Weryfikacja stanu wdrożeń w Coolify API...")
try:
    verify_no_running_deployment(client, app_uuid)
except UncertainDeployment as e:
    print(f"BŁĄD: Niejednoznaczny status wdrożenia ({e}). ZATRZYMAJ SIĘ i sprawdź dashboard Coolify!", file=sys.stderr)
    sys.exit(1)
except ReleaseError as e:
    print(f"BŁĄD: Wykryto trwające wdrożenie ({e}). Zbadaj i anuluj przed rollbackiem!", file=sys.stderr)
    sys.exit(1)

# 2. Sprawdzenie zgodności kontraktu zasobu przed mutacją
app = client.get_application(app_uuid)
verify_application(app, contract, app_uuid, require_healthy=False)

# 3. Bezpieczne wykonanie procedury rollback
print("Rozpoczynanie kontrolowanego rollbacku...")
rollback(
    client=client,
    application_uuid=app_uuid,
    previous_tag="sha256-<PREVIOUS_STABLE_DIGEST_HEX>",
    previous_revision="<PREVIOUS_STABLE_COMMIT_SHA>",
    failed_revision="<FAILED_COMMIT_SHA>",
    contract=contract,
    public_url="https://inventory-generator.grela.dev",
    timeout=300,
    interval=2.0,
    health_attempts=30
)
print("Manualny rollback zakończony pomyślnie.")
'
```

### 2.3. Weryfikacja po rollbacku:
```bash
# Sprawdzenie publicznego endpointu zdrowia
curl -s https://inventory-generator.grela.dev/api/health | jq .

# Uruchomienie bazowych testów dymnych (z flagami nazwanymi)
python3 -m infra.smokecheck --base-url https://inventory-generator.grela.dev --expected-revision <PREVIOUS_STABLE_COMMIT_SHA>
```

---

## 3. Inspekcja Rzeczywistego Środowiska Uruchomieniowego (Effective-Runtime Readback)

Deklaracje w plikach konfiguracyjnych muszą odpowiadać rzeczywistym parametrom kontenera uruchomionego na serwerze VPS. Poniższe polecenia weryfikują stan faktyczny (*effective state*):

### 3.1. Identyfikacja aktywnego kontenera:
Podczas standardowej pracy w Coolify działa dokładnie jeden kontener aplikacji. W trakcie procedury rolling update mogą chwilowo istnieć 2 kontenery (nakładanie instancji).

Etykieta `coolify.applicationId` w Coolify 4.3.14 przechowuje **wewnętrzny numeryczny identyfikator bazy danych (integer)**, a nie UUID zasobu. Wyszukiwanie kontenera realizowane jest przez jednoznaczny odczyt numerycznego ID z Coolify API lub przez prefiks nazwy kontenera generowanej przez Coolify (`<APPLICATION_UUID>`):

```bash
# Metoda 1 (Zalecana): Pobranie rzeczywistego numerycznego ID aplikacji z Coolify API
APP_NUMERIC_ID=$(curl -s -f -H "Authorization: Bearer $COOLIFY_TOKEN" \
  https://coolify.internal.grela.dev/api/v1/applications/<APPLICATION_UUID> | jq -r '.id // empty')

if [ -n "$APP_NUMERIC_ID" ] && [ "$APP_NUMERIC_ID" != "null" ]; then
  echo "Zidentyfikowano numeryczne ID aplikacji: $APP_NUMERIC_ID"
  CONTAINERS=$(docker ps -q --filter "label=coolify.applicationId=${APP_NUMERIC_ID}" --filter "status=running")
else
  # Metoda 2 (Fallback): Jednoznaczne dopasowanie po prefiksie nazwy kontenera dla danego UUID zasobu
  echo "Brak odpowiedzi API Coolify - wyszukiwanie po prefiksie nazwy kontenera dla UUID zasobu..."
  CONTAINERS=$(docker ps -q --filter "name=^/<APPLICATION_UUID>" --filter "status=running")
fi

CONTAINER_COUNT=$(echo $CONTAINERS | wc -w)

if [ "$CONTAINER_COUNT" -eq 1 ]; then
  CONTAINER_ID="$CONTAINERS"
  echo "Aktywny pojedynczy kontener produkcyjny: $CONTAINER_ID"
elif [ "$CONTAINER_COUNT" -gt 1 ]; then
  echo "Wykryto $CONTAINER_COUNT aktywnych kontenerów (rolling overlap lub dryf stanu):" >&2
  FILTER_ARGS=()
  for cid in $CONTAINERS; do
    FILTER_ARGS+=(--filter "id=$cid")
  done
  docker ps "${FILTER_ARGS[@]}" --format "table {{.ID}}\t{{.Names}}\t{{.CreatedAt}}\t{{.Status}}"
  echo "Wybierz docelowy CONTAINER_ID ręcznie przed wykonaniem inspekcji." >&2
  exit 1
else
  echo "BŁĄD: Brak uruchomionych kontenerów dla aplikacji <APPLICATION_UUID>!" >&2
  exit 1
fi
```

### 3.2. Weryfikacja ograniczeń zasobów (Cgroups limits):
```bash
# Limit pamięci RAM (Oczekiwane: 536870912 bajtów = 512 MiB)
docker inspect "$CONTAINER_ID" --format '{{.HostConfig.Memory}}'

# Limit CPU (Oczekiwane: 1000000000 NanoCPUs = 1.0 vCPU)
docker inspect "$CONTAINER_ID" --format '{{.HostConfig.NanoCpus}}'

# Wymiana pamięci (Memory swap limit - brak niekontrolowanego swapowania)
docker inspect "$CONTAINER_ID" --format '{{.HostConfig.MemorySwap}}'
```

### 3.3. Weryfikacja bezpieczeństwa procesu:
```bash
# Uprawnienia użytkownika (Oczekiwane: 1654:1654 - proces nie działa jako root)
docker inspect "$CONTAINER_ID" --format '{{.Config.User}}'

# Status RestartPolicy (Oczekiwane: unless-stopped lub on-failure)
docker inspect "$CONTAINER_ID" --format '{{.HostConfig.RestartPolicy.Name}}'

# Etykieta commit SHA w obrazie
docker inspect "$CONTAINER_ID" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

### 3.4. Odczyt publicznych nagłówków i rewizji:
```bash
curl -I https://inventory-generator.grela.dev
# Weryfikacja obecności nagłówków: Content-Security-Policy, X-Content-Type-Options: nosniff,
# X-Frame-Options: DENY, Strict-Transport-Security, Referrer-Policy.

curl -s https://inventory-generator.grela.dev/api/health
# Oczekiwane: {"status":"ok","revision":"<DOKŁADNY_COMMIT_SHA>"}
```

---

## 4. Protokół Pomiaru Nakładania się Instancji (Measured Rolling Overlap Protocol)

Zgodnie z `docs/decisions/2026-10-03-inventory-process-local-limits.md` (w prywatnym repozytorium infrastruktury `SzczepanGrela/grela-dev-infrastructure`), Inventory Generator korzysta z lokalnych dla procesu liczników rate limitera (token bucket: pojemność 10 jednostek kosztu, uzupełnianie 1/6s) oraz semafora współbieżności eksportu (maksymalnie 3 równoległe sloty obejmujące wszystkie formaty: DOCX, CSV i HTML, z natychmiastowym odrzuceniem no-wait HTTP 429 Retry-After: 1). 

Podczas aktualizacji typu *rolling update* przez krótki czas (zwykle 10–30 sekund) mogą działać równolegle dwa kontenery (stary i nowy). Oznacza to potencjalne chwilowe podwojenie dopuszczalnego obciążenia procesora i pamięci (do 6 slotów i podwójnej sterty).

> [!WARNING]
> **ZAKAZ TESTÓW BEZ UZGODNIONEGO OKNA OPERACYJNEGO**
> Nigdy nie uruchamiaj testów obciążeniowych ani testów awaryjnych na produkcyjnym VPS bez zatwierdzonego okna serwisowego z koordynatorem, przygotowanego stabilnego wydania bazowego do rollbacku oraz monitorowania sąsiednich usług (TTT, NetFilmx).

### 4.1. Wymagania wstępne (Pre-conditions):
1. Zapisany i sprawdzony skrót ostatniego stabilnego wydania (`PREVIOUS_STABLE_DIGEST`).
2. Uzgodnione okno serwisowe o niskim ruchu sieciowym.
3. Uruchomiony równoległy monitoring hosta i sąsiednich aplikacji.

### 4.2. Monitorowanie parametrów w trakcie testu:
Operator uruchamia w osobnych terminalach monitoring hosta:

```bash
# Terminal 1: Zużycie pamięci i swapu hosta co 1 sekundę
vmstat 1

# Terminal 2: Wykorzystanie CPU i pamięci przez kontenery Docker
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

# Terminal 3: Monitorowanie sąsiadującej aplikacji TicTacToe (tictactoe.grela.dev)
# Żądania ograniczone limitami czasowymi (--connect-timeout 2, --max-time 5)
# oraz skończoną liczbą 30 iteracji co 2s.
# Rzeczywisty budżet czasowy: 30 prób × (do 5s na żądanie HTTP + 2s sleep)
# = od minimum ok. 60s (przy natychmiastowych odpowiedziach) do maksymalnie ok. 210s (~3,5 min) przy wyczerpywaniu limitu czasu.
for i in $(seq 1 30); do
  STATUS=$(curl -o /dev/null -s -w "%{http_code} %{time_total}s\n" \
    --connect-timeout 2 --max-time 5 \
    https://tictactoe.grela.dev)
  echo "$(date -u +%T) [próba $i/30] TTT status: $STATUS"
  sleep 2
done
```

### 4.3. Scenariusz testowy:
1. Wygenerowanie legalnego syntetycznego obciążenia referencyjnego dla Inventory (żądania CSV, HTML i DOCX w ramach limitów: max 3 współbieżne sloty bez oczekiwania).
2. Wywołanie przeładowania kontenera / wdrożenia nowego wydania w Coolify.
3. Pomiar parametrów podczas nakładania się starego i nowego kontenera:
   - Czas trwania nakładania się (rolling overlap duration w sekundach).
   - Maksymalny sumaryczny RAM alokowany przez oba kontenery Inventory.
   - Wpływ na opóźnienia i dostępność sąsiedniej aplikacji TTT.

### 4.4. Ścisłe Progi Zatrzymania (Stop Thresholds / Abort Criteria):
Test musi zostać **natychmiast przerwany**, a procedura rollbacku uruchomiona, jeżeli:
- **Dostępna pamięć RAM hosta spadnie poniżej 1000 MiB** (`free -m | awk '/Mem:/ {print $7}' < 1000`).
- **Wskaźnik obciążenia systemu (load average) przekroczy 3.5** (nasycenie kolejki zadań systemowych na maszynie wielordzeniowej) LUB rzeczywiste sumaryczne wykorzystanie CPU hosta (`vmstat` / `docker stats`) przekroczy 85% przez ponad 15 sekund.
- **Opóźnienie odpowiedzi sąsiedniej aplikacji TTT przekroczy 500 ms** lub TTT zwróci jakikolwiek kod błędu HTTP 5xx.
- **Wystąpienie zdarzenia OOM Killer na kontenerze aplikacji**. Sam kod wyjścia 137 (SIGKILL) nie jest jednoznacznym dowodem OOM (może oznaczać manualne zatrzymanie lub timeout). Operator weryfikuje faktyczny OOM poprzez sprawdzenie: `docker inspect <CONTAINER_ID> --format '{{.State.OOMKilled}}'` (oczekiwane `true`), liczniki `oom_kill` w cgroup v2 (`/sys/fs/cgroup/.../memory.events`) lub wpisy w logach jądra `dmesg -T | grep -i oom`.
- Jakiekolwiek żądanie użytkownika w oknie przełączenia zakończy się nieoczekiwanym błędem 502/503/504 trwającym dłużej niż 3 kolejne próby.

### 4.5. Akcja awaryjna przy przekroczeniu progu:
W przypadku naruszenia progu operator natychmiast zatrzymuje generowanie ruchu testowego i wykonuje manualny rollback według sekcji 2.2.
