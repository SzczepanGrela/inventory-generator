# Procedury Operatorskie Inventory Generator (Operator Runbook)

Dokument określa procedury weryfikacji wydania, wycofania (rollback), inspekcji środowiska uruchomieniowego (*effective-runtime readback*) oraz protokół pomiaru nakładania się kontenerów (*rolling overlap*) na współdzielonym serwerze VPS.

Zgodnie z decyzją architektoniczną `docs/decisions/2026-10-03-inventory-process-local-limits.md` oraz wytycznymi koordynatora, **wszelkie testy obciążeniowe i awaryjne na współdzielonym VPS wymagają skoordynowanego okna operacyjnego, aktywnych progów zatrzymania (stop thresholds) oraz zapisanego stabilnego wydania bazowego**.

---

## 1. Odrzucenie Kandydata (Candidate Rejection)

Przed wdrożeniem lub w trakcie weryfikacji przedwdrożeniowej operator weryfikuje integralność artefaktu i zgodność ze specyfikacją Coolify. Kandydat zostaje bezwzględnie **odrzucony**, jeśli nie spełnia któregokolwiek z poniższych warunków.

### Kryteria odrzucenia:
1. **Niezgodność skrótu (Digest Mismatch)**: Obraz nie jest przypięty unikalnym skrótem `sha256:...`.
2. **Brak lub negatywna atestacja SLSA/Provenance**: Atestacja GitHub Actions nie weryfikuje się pomyślnie.
3. **Dryf konfiguracji Coolify (Configuration Drift)**: Rzeczywista konfiguracja zasobu w Coolify różni się od kontraktu `infra/coolify-production.json` (np. limit RAM > 512 MiB, CPU > 1.0, porty, zmienne środowiskowe).
4. **Podatności wysokiego ryzyka**: Skaner Trivy wykrywa nienaprawione podatności HIGH lub CRITICAL w warstwach aplikacji.

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

Mechanizm wycofania zapewnia natychmiastowe przywrócenie poprzedniej znanej, stabilnej wersji w przypadku niepowodzenia wdrożenia.

### 2.1. Automatyczny Rollback w `coolify_release.py`
Wbudowany skrypt wdrożeniowy automatycznie wycofuje zmiany w przypadku:
- Przekroczenia limitu czasu wdrożenia w Coolify (`--deployment-timeout`).
- 3 kolejnych nieudanych prób odpytania publicznego endpointu zdrowia (`monitor.consecutive_failures >= 3`).
- Niepowodzenia testów dymnych `infra.smokecheck.check_release` po przełączeniu ruchu.
- Braku ustabilizowania się nowej rewizji w oknie obserwacyjnym (*soak period*).

Skrypt automatycznie przywraca poprzedni tag obrazu (`previous_tag`), weryfikuje stan `running:healthy` oraz sprawdza endpoint `/api/health` dla poprzedniej rewizji `previous_revision`.

### 2.2. Procedura Manualnego Rollbacku przez Operatora
Jeżeli automatyczny proces zawiedzie lub wymagane jest natychmiastowe wycofanie ręczne:

```bash
# Opcja A: Wycofanie przez ponowne uruchomienie workflow GitHub Actions ze znanym stabilnym SHA
gh workflow run deploy.yml \
  --ref main \
  -f target_digest="sha256:<PREVIOUS_STABLE_DIGEST>" \
  -f expected_revision="<PREVIOUS_STABLE_COMMIT_SHA>"

# Opcja B: Bezpośrednie przywrócenie w Coolify API w sytuacji awarii CI/CD
python3 -c '
from pathlib import Path
from infra.coolify_release import CoolifyClient, load_contract, rollback, token_from_environment

client = CoolifyClient("https://coolify.internal.grela.dev", token_from_environment())
contract = load_contract(Path("infra/coolify-production.json"))

rollback(
    client=client,
    application_uuid="<APPLICATION_UUID>",
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

# Uruchomienie bazowych testów dymnych
python3 -m infra.smokecheck https://inventory-generator.grela.dev <PREVIOUS_STABLE_COMMIT_SHA>
```

---

## 3. Inspekcja Rzeczywistego Środowiska Uruchomieniowego (Effective-Runtime Readback)

Deklaracje w plikach konfiguracyjnych muszą odpowiadać rzeczywistym parametrom kontenera uruchomionego na serwerze VPS. Poniższe polecenia weryfikują stan faktyczny (*effective state*):

### 3.1. Identyfikacja aktywnego kontenera:
```bash
CONTAINER_ID=$(docker ps --filter "name=inventory-generator" --format "{{.ID}}")
echo "Aktywny kontener: $CONTAINER_ID"
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

Zgodnie z `docs/decisions/2026-10-03-inventory-process-local-limits.md`, Inventory Generator korzysta z lokalnych dla procesu liczników rate limitera (token bucket: pojemność 10 jednostek kosztu, uzupełnianie 1/6s) oraz semafora współbieżności DOCX (maksymalnie 3 równoległe sloty). 

Podczas aktualizacji typu *rolling update* przez krótki czas (zwykle 10–30 sekund) mogą działać równolegle dwa kontenery (stary i nowy). Oznacza to potencjalne chwilowe podwojenie dopuszczalnego obciążenia procesora i pamięci.

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

# Terminal 3: Ciągły test dymny sąsiadującej aplikacji (TTT)
while true; do
  STATUS=$(curl -o /dev/null -s -w "%{http_code} %{time_total}s\n" https://ttt.grela.dev)
  echo "$(date -u +%T) TTT status: $STATUS"
  sleep 1
done
```

### 4.3. Scenariusz testowy:
1. Wygenerowanie legalnego syntetycznego obciążenia referencyjnego dla Inventory (równoległe żądania CSV, HTML i DOCX w ramach limitów: max 3 współbieżne DOCX).
2. Wywołanie przeładowania kontenera / wdrożenia nowego wydania w Coolify.
3. Pomiar parametrów podczas nakładania się starego i nowego kontenera:
   - Czas trwania nakładania się (rolling overlap duration w sekundach).
   - Maksymalny sumaryczny RAM alokowany przez oba kontenery Inventory.
   - Wpływ na opóźnienia i dostępność sąsiedniej aplikacji TTT.

### 4.4. Ścisłe Progi Zatrzymania (Stop Thresholds / Abort Criteria):
Test musi zostać **natychmiast przerwany**, a procedura rollbacku uruchomiona, jeżeli:
- **Dostępna pamięć RAM hosta spadnie poniżej 1000 MiB** (`free -m | awk '/Mem:/ {print $7}' < 1000`).
- **Suma obciążenia CPU (load average) przekroczy 3.5** lub utrzyma się na poziomie > 85% przez ponad 15 sekund.
- **Opóźnienie odpowiedzi sąsiedniej aplikacji TTT przekroczy 500 ms** lub TTT zwróci jakikolwiek kod błędu HTTP 5xx.
- **Kontener Inventory zostanie zabity przez OOM Killer** (kod wyjścia 137 w `docker ps -a` lub wpis w `dmesg`).
- Jakiekolwiek żądanie użytkownika w oknie przełączenia zakończy się nieoczekiwanym błędem 502/503/504 trwającym dłużej niż 3 kolejne próby.

### 4.5. Akcja awaryjna przy przekroczeniu progu:
W przypadku naruszenia progu operator natychmiast zatrzymuje test generowania ruchu i wykonuje manualne zatrzymanie kontenera kandydata lub rollback według sekcji 2.2.
