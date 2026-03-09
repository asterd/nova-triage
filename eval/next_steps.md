# NovaTriage Next Steps

Questo file raccoglie il backlog del giro successivo, dopo la chiusura del perimetro P0/P1.

Va usato solo dopo aver completato e verificato gli obiettivi descritti in `spec_p.md`.

## Principi

- non aprire nuovi fronti se la demo core non è stabile
- non aumentare la complessità tecnica se il valore percepito in judging è basso
- privilegiare sempre ciò che rafforza impatto, affidabilità e narrativa

## Backlog successivo

### 1. Privacy avanzata su allegati binari

Da affrontare solo dopo che il supporto P0 su testo e PDF text-native è chiuso.

Possibili attività:

- OCR client-side sperimentale su immagini o PDF scansiti
- review mode con bounding boxes e conferma utente
- pipeline fallback AWS privacy-zone più robusta
- report di rischio residuo più sofisticato

Decisione da prendere:

- se il costo in performance mobile è troppo alto, mantenere approccio ibrido

### 2. Submission architecture pack

Preparare materiale esplicativo per giudici.

Attività:

- architettura AWS pulita in diagramma
- tabella `what runs client-side / what runs server-side`
- tabella `deterministic vs model-driven`
- tabella `privacy controls`
- pagina o sezione README `Why Nova`

### 3. Demo optimization

Raffinare il prodotto per il video finale.

Attività:

- tempi flow ottimizzati
- microcopy finale
- transizioni meno brusche
- dataset demo perfetti
- script demo con ordine esatto dei passaggi

### 4. Referti v2

Attività possibili:

- estrazione di evidenze puntuali dal documento
- highlight delle aree più rilevanti
- timeline findings
- confronto referto vs sintomatologia

### 5. Farmaci v2

Attività possibili:

- modalità pediatrica più rigorosa
- tabelle per range di peso
- dataset interno per pochi farmaci demo-safe
- separazione forte tra info generali e guidance posologica

### 6. Agentic UI v2

Attività possibili:

- vista “analysis trace”
- planner visuale
- moduli attivati e confidenza
- branch explanation

### 7. Persistenza e audit

Solo se utile a demo e non destabilizza.

Attività:

- salvataggio casi su backend
- audit minimale dei passaggi pipeline
- retention policy esplicita

### 8. Offline e resilienza

Attività:

- draft offline più robusti
- retry queue per submit
- stato sync più chiaro

## Cose da valutare prima di iniziare

Prima di aprire un nuovo step chiedersi:

1. migliora chiaramente il giudizio tecnico o di impatto?
2. è visibile in demo?
3. riduce un rischio reale della submission?
4. è completabile senza introdurre fragilità?

Se almeno 2 risposte su 4 sono `no`, non è priorità.

## Possibili direttrici post-hackathon

Queste non sono priorità immediate, ma possono orientare la roadmap:

- privacy enterprise con enclave o isolamento più spinto
- supporto multilingua PII/PHI più sofisticato
- protocol packs clinici più ricchi
- integrazione dati clinici reali
- maggiore explainability per contesto ospedaliero

## Definition of readiness per il giro successivo

Il backlog di questo file va toccato solo quando:

- demo core è stabile
- build/test non sono bloccanti
- privacy P0 è dimostrabile
- triage/referti/farmaci sono coerenti come prodotto unico
