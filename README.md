# Kalkulačka ceny dopravy – Brandýs nad Labem

Porovnání cen dopravy **Raben**, **DNP** a **Vnitro** (včetně pražských pásem **1P–6P**).

## Lokální spuštění

```powershell
py -3 build_data.py "e:\AI\vnitro dopravy\Brandys\Vnitro_Brandys_final.xlsx"
py -3 server.py
```

Otevřete `http://localhost:8081`

## Aktualizace dat z Excelu

Po změně ceníku nebo zón v `Vnitro_Brandys_final.xlsx`:

```powershell
py -3 build_data.py "e:\AI\vnitro dopravy\Brandys\Vnitro_Brandys_final.xlsx"
```

## Logika výpočtu

| Dopravce | Zóna | Cena |
|----------|------|------|
| **Raben** | Vlastní mapování PSČ → zóny 1–8 | Tarif podle hmotnosti (max. **3 000 kg**) |
| **DNP** | Vlastní mapování PSČ → zóny 1–12 | Tarif podle hmotnosti (max. **2 500 kg**) |
| **Vnitro** | Pásmo ze listu Zóny Brandýs (1–23) | Limit do CN, nejnižší cena, 5 dopravců + palivo 12 % |
| **Praha P** | Pásmo 1P–6P ze Zóny Brandýs | 3 dopravci + palivo 12 % |

Ceny jsou v **Kč bez DPH**. U Vnitra je palivový příplatek 12 % započten automaticky.
