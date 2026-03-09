# NovaTriage P0/P1 Delivery Spec

Questo documento definisce il perimetro operativo da eseguire nel prossimo giro di implementazione.
Obiettivo: portare il prodotto a uno stato altamente competitivo per hackathon, concentrandosi solo su ciò che è realisticamente raggiungibile e visibile in demo.

## Missione

Portare `NovaTriage` a uno stato `demo-stable`, con forte aderenza a:

- `Agentic AI`
- `Multimodal Understanding`
- `Voice AI`
- `Privacy-first clinical decision support`

Vincoli:

- niente feature speculative che aumentano molto la complessità ma poco il punteggio percepito
- preservare lo stile grafico esistente
- massimizzare affidabilità, chiarezza demo e credibilità tecnica

## Obiettivi P0

### P0.1 Build e runtime affidabili

Il progetto deve essere eseguibile in modo coerente.

Deliverable:

- fix della build frontend in ambiente locale standard
- `docker compose up --build` funzionante e documentato
- verifica che frontend e API si alzino correttamente
- healthcheck chiari
- fallback di errore leggibili in UI

Definition of done:

- `apps/frontend-pwa` builda senza workaround manuali non documentati
- `apps/triage-api` builda
- la documentazione locale è sufficiente per far girare il progetto
- il flow demo non si rompe in caso di errore Bedrock ma fallisce in modo chiaro

Attività:

1. verificare e correggere dipendenze frontend che bloccano la build
2. verificare configurazione Next/Tailwind/PostCSS
3. verificare `docker-compose.yml` e mapping env
4. aggiungere o migliorare endpoint health e messaggi di errore user-facing

### P0.2 Triage end-to-end robusto

Il flow triage deve apparire completo e credibile.

Deliverable:

- setup caso
- intake testuale
- intake vocale
- upload allegati
- analisi backend via Nova
- risultato finale stabile
- salvataggio caso

Definition of done:

- il flow funziona da mobile viewport
- gli stati loading/error sono coerenti
- nessun passaggio critico dipende da hardcode fragili
- il risultato mostra chiaramente urgenza, red flags, cluster, handoff e summary

Attività:

1. chiudere tutte le stringhe hardcoded residue nel flow triage
2. verificare persistenza `case_setup`, `latest_result`, `saved_cases`
3. migliorare gli stati di errore lato UI e lato API
4. rendere coerente il rendering delle destinazioni e delle label protocollo

### P0.3 Safety engine deterministico reale

L’app non deve sembrare solo una catena di prompt.

Deliverable:

- rules engine safety con override su alcuni casi ad alto rischio
- esposizione dei `rules_triggered`
- chiara distinzione tra logica deterministica e ragionamento del modello

Definition of done:

- esistono regole reali implementate nel backend
- le regole influenzano l’esito finale quando necessario
- il risultato espone quando una safety escalation è stata applicata

Regole minime da coprire:

- dolore toracico severo con onset improvviso
- dispnea severa
- sintomi neurologici compatibili con stroke
- altered mental status
- sospetta anafilassi
- emorragia importante
- febbre alta in infante o paziente fragile

Attività:

1. introdurre un modulo safety/rules nel backend
2. integrare il suo output nella pipeline orchestrator
3. esporre i `rules_triggered` nel risultato
4. mostrare in UI badge o blocco “Safety escalation applied”

### P0.4 Privacy dimostrabile e verificabile

La privacy deve essere un vantaggio competitivo concreto, non solo dichiarato.

Deliverable:

- redazione client-side del testo
- redazione client-side dei PDF testuali
- gestione `best effort` degli allegati binari
- `Privacy Lab` capace di mostrare prima/dopo e rischio residuo
- blocco o warning forte se il rischio residuo è alto

Definition of done:

- testo e file testuali sono realmente redatti prima dell’upload
- il sistema etichetta i file come:
  - `verified`
  - `best effort`
  - `manual review required`
- il rischio residuo è misurabile

Attività:

1. completare il supporto a PDF text-native lato client
2. aggiungere rilevazione PII residua e threshold
3. impedire l’invio automatico se il rischio residuo supera soglia
4. migliorare `Privacy Lab` con report più esplicito

Nota di scope:

- OCR locale completo su immagini/PDF scansiti non è P0
- per immagini e scansiti è sufficiente una gestione trasparente `best effort + review`

### P0.5 Internazionalizzazione completa

L’i18n deve essere coerente in tutta l’app e nelle risposte AI.

Deliverable:

- lingua browser letta correttamente
- fallback su lingua supportata / salvata / default
- UI tradotta
- output AI tradotto
- label, red flags, cluster e destinazioni coerenti

Definition of done:

- test manuale almeno su `it` e `en`
- nessun hardcode importante rimasto nel prodotto finale
- i prompt Bedrock rispettano la lingua selezionata

Attività:

1. chiudere traduzioni mancanti nelle pagine storiche e nuove
2. verificare output backend per tutte le sezioni
3. uniformare destinazioni, protocolli, urgenza e disclaimer

### P0.6 Demo readiness

Serve un percorso dimostrabile in 3 minuti.

Deliverable:

- 3 scenari demo predefiniti
- contenuti demo ripetibili
- ordine dei passaggi chiaro

Scenari minimi:

1. triage home care con sintomi + voce + allegato
2. analisi referto con output oggettivo
3. utilità farmaco con controindicazioni e tabella dose

Definition of done:

- ogni scenario è eseguibile senza improvvisazione
- i dati demo sono già disponibili
- ogni scenario evidenzia almeno un punto forte del prodotto

## Obiettivi P1

### P1.1 Agentic orchestration più visibile

La pipeline deve sembrare un sistema agentico e non solo un backend sequenziale.

Deliverable:

- step pipeline visibili
- decision routing o audit trail
- clarification loop se mancano dati importanti

Definition of done:

- il sistema può mostrare i passaggi attivati
- quando mancano dati rilevanti genera domande mirate
- l’utente percepisce che il sistema “pianifica” e non solo “risponde”

Attività:

1. introdurre stati di orchestrazione espliciti
2. aggiungere clarification questions quando il contesto è insufficiente
3. esporre audit trail sintetico in UI o nel payload risultato

### P1.2 Modulo referti con qualità da demo

Deve sembrare una funzionalità completa, non un side feature.

Deliverable:

- summary oggettivo
- rilievi principali
- punti di attenzione
- elementi rassicuranti
- follow-up suggerito
- severità/confidenza

Definition of done:

- il layout è leggibile e convincente
- il disclaimer è sempre presente
- l’analisi supporta testo e allegati

Attività:

1. aggiungere severity tag ai punti di attenzione
2. mostrare confidence in modo elegante
3. migliorare card e gerarchia visiva

### P1.3 Modulo farmaci con guardrail

Deve essere utile ma non sembrare prescrittivo.

Deliverable:

- overview farmaco
- indicazioni generali
- controindicazioni principali
- interazioni rilevanti
- tabella dose leggibile
- risposta mirata a domanda specifica

Definition of done:

- il prodotto non dà l’impressione di prescrivere
- i disclaimer sono chiari
- la dose guidance è presentata come supporto informativo

Attività:

1. aggiungere guardrail lato prompt e lato UI
2. rendere la tabella dose più chiara e coerente
3. limitare i casi demo a scenari adatti e sicuri

### P1.4 Privacy fallback AWS-side progettato e, se realistico, implementato in forma minimale

Non fare over-engineering, ma preparare un fallback credibile per allegati binari.

Deliverable:

- design document o implementazione minima per `privacy zone`
- raw file non inviato direttamente al motore Bedrock generale
- chiaro flusso di redazione prima dell’analisi

Definition of done:

- esiste un percorso architetturale chiaro con AWS
- se implementato, è minimale e non destabilizza il prodotto

Soluzione preferita:

- S3 cifrato
- Textract per estrazione testo
- rilevazione/redazione PII/PHI
- passaggio a Bedrock solo del contenuto redatto

Nota:

- se questa parte rischia di rallentare troppo il giro, fermarsi al design document + interfaccia ready

### P1.5 Polish UX mobile

Deliverable:

- shell coerente
- spacing e gerarchie visive uniformi
- bottom navigation stabile
- loading state e success state curati

Definition of done:

- le tre aree principali sembrano un unico prodotto
- nessun layout rotto su viewport mobile stretta
- i componenti principali sono visivamente coerenti

## Non fare in questo giro

Non implementare se non resta tempo reale:

- OCR wasm totale e affidabile su mobile low-end
- Nitro Enclaves
- compliance/regolatorio enterprise
- dataset farmaci esteso e “completo”
- workflow clinici molto più profondi del necessario per demo
- offline full-featured complesso

## Ordine di esecuzione richiesto

Eseguire nel seguente ordine:

1. build/runtime reliability
2. safety engine
3. privacy P0
4. i18n cleanup
5. demo scenario hardening
6. agentic visibility
7. report polish
8. medication polish
9. AWS privacy fallback solo se resta margine

## Output atteso dal prossimo giro

Il prossimo giro deve:

- implementare P0 completo
- chiudere quanto più possibile P1 senza destabilizzare il progetto
- eseguire test e build verificabili
- lasciare un riepilogo finale con:
  - cosa è stato completato
  - cosa resta aperto
  - quali limitazioni sono oggettive e non vale la pena forzare in hackathon

## Criterio decisionale

Se una scelta è tra:

- funzione più ampia ma fragile
- funzione più piccola ma dimostrabile

scegliere sempre la seconda.

L’obiettivo non è “fare tutto”.
L’obiettivo è sembrare chiaramente uno dei progetti più maturi e credibili del contest.
