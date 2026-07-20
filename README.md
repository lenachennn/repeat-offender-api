# Repeat-Offender-API fuer Chatty

Kleine API, die sich pro Kanal + Nutzer die Anzahl der Verstoesse merkt und eine
eskalierende Timeout-Dauer zurueckgibt. Chatty ruft sie beim Timeouten auf und
setzt die Dauer automatisch - Wiederholungstaeter bekommen so immer laengere Timeouts.

Laeuft auf dem Contabo-Server (`185.249.225.83`) unter pm2, Port `8787`.

## Endpunkte

| Endpunkt | Zweck |
|---|---|
| `/next?key=KEY&user=NAME&chan=KANAL` | Zaehlt Verstoss hoch, gibt neue Timeout-Dauer (Sekunden) zurueck |
| `/status?key=KEY&user=NAME&chan=KANAL` | Zeigt Zaehler + naechste Dauer (ohne hochzuzaehlen) |
| `/reset?key=KEY&user=NAME&chan=KANAL` | Setzt einen Nutzer zurueck |
| `/list?key=KEY&chan=KANAL` | Alle Wiederholungstaeter des Kanals als JSON (fuer das Chat-Fenster) |

Eskalations-Stufen und Zuruecksetz-Zeit werden in der `.env` eingestellt
(`TIERS`, `DECAY_DAYS`).

## Chatty einrichten

### 1. Custom Command anlegen
Chatty -> **Settings -> Commands** -> Feld "Custom Commands", diese Zeile einfuegen
(KEY durch den echten API_KEY aus der .env ersetzen).
WICHTIG: Custom Commands nutzen ein LEERZEICHEN nach dem Namen, kein `=`
(das `=` gilt nur fuer Menue-Eintraege):

```
/ro /timeout $$1 $request(http://185.249.225.83:8787/next?key=KEY&user=$$1&chan=$(chan)) $(2-)
```

### 2. Rechtsklick-Menue anlegen
Chatty -> **Settings -> Menu/Context Menus** -> "User context menu", diese Zeile einfuegen:

```
Repeat Offender[R]=/ro $$1
```

Damit erscheint im Rechtsklick auf einen Nutzer der Eintrag **Repeat Offender**
(Tastenkuerzel R). Ein Klick setzt automatisch den passenden Timeout.
Grund optional mitgeben: das Menue kann man erweitern, oder `/ro name grund` direkt tippen.

### 3. Status / Reset (im Browser)
Einfach im Browser oeffnen (KEY, Name, Kanal anpassen):

- Status: `http://185.249.225.83:8787/status?key=KEY&user=NAME&chan=KANAL`
- Reset:  `http://185.249.225.83:8787/reset?key=KEY&user=NAME&chan=KANAL`

## Chat-Fenster (chat-fenster.html)

Ein zusaetzliches Nur-Lese-Fenster NEBEN Chatty - ersetzt Chatty nicht.
Einfach `chat-fenster.html` doppelklicken (oeffnet im Browser), Kanalnamen eingeben,
"Verbinden". Kein Login noetig (liest den Twitch-Chat anonym).

Markiert automatisch:
- **Wiederholungstaeter** (aus der API): 1x gelb, 2x orange, 3x+ rot, mit Timeout-Zaehler
- **Gleiche Nachricht innerhalb von 5 Minuten**: rot hinterlegt mit x2/x3-Zaehler

API-Adresse und API-Key sind oben im Fenster einstellbar (werden lokal gemerkt).

## Hinweise

- Der API_KEY steht im Klartext in der Chatty-Konfiguration und in der URL. Er
  verhindert nur, dass Fremde den Zaehler manipulieren - halte ihn trotzdem privat.
- Twitch-Timeout-Maximum sind 1209600 Sekunden (14 Tage); danach waere ein Ban noetig.
