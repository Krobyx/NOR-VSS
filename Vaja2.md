## Vaja 2: Vizualizacija scen (scene design)

### Namen vaje

Namen druge vaje je, da študent **vizualno prikaže ključne scene** svoje VR ali AR aplikacije.
S tem študent preveri prostorsko zasnovo, kontekst uporabe in osnovno uporabniško izkušnjo še **pred tehnično implementacijo**.

Vaja spodbuja razmišljanje v 3D prostoru in služi kot osnova za nadaljnji razvoj aplikacije v Unityju.

---

### Naloga

Na podlagi ideje iz **Vaje 1** mora študent izdelati **vizualne prikaze (slike) ključnih scen** aplikacije.

Priporočeno je, da študent izdela **vsaj 3 scene**, na primer:

* začetna scena (vstop v aplikacijo),
* glavna interakcijska scena,
* dodatna scena (npr. rezultat, povratna informacija, prehod).

Slike lahko izdelate z uporabo:

* **AI orodij za generiranje slik** (npr. *NanoBanana*, DALL·E, Midjourney, Stable Diffusion),
* ali drugih orodij za vizualizacijo (3D orodja, mockupi, skice).

Pomembno je, da slike **odražajo kontekst VR ali AR uporabe** (perspektiva, prostor, objekti, uporabnik).

---

### Zahtevana vsebina

Za vsako sceno mora biti priloženo:

1. **Naziv scene**
2. **Slika scene**
3. **Kratek opis scene**, ki vključuje:

   * kaj uporabnik vidi,
   * kaj uporabnik lahko počne (interakcije),
   * namen scene v aplikaciji.

---

### Oblika oddaje

* V repozitoriju ustvarite mapo:

  ```
  /vaja-02/
  ```
* V mapo dodajte:

  * podmapo `/images/` (slike scen),
  * datoteko `scenes.md`.

Primer strukture:

```
/vaja-02/
 ├─ images/
 │   ├─ scene-01.png
 │   ├─ scene-02.png
 │   └─ scene-03.png
 └─ scenes.md
```

Primer strukture datoteke `scenes.md`:

```md
# Vizualizacija scen VR/AR aplikacije

## Scena 1: Uvodna scena
![Scena 1](images/scene-01.png)

**Opis:**
Kratek opis dogajanja, okolja in interakcij.

## Scena 2: Glavna interakcija
![Scena 2](images/scene-02.png)

**Opis:**
Kratek opis glavne funkcionalnosti aplikacije.

## Scena 3: Zaključek / rezultat
![Scena 3](images/scene-03.png)

**Opis:**
Kratek opis zaključne ali povratne scene.
```

---

### Način oddaje

* Naloga je uspešno oddana, ko je:

  * vsebina ustrezno strukturirana,
  * slike dodane v repozitorij,
  * datoteka `scenes.md` izpolnjena,
  * **commitana** in **pushana** do roka oddaje.
* Primer commit sporočila:

  ```
  Add scene visualizations for VR/AR application
  ```

---

### Merila ocenjevanja

Vaja se ocenjuje na podlagi:

* smiselnosti in jasnosti scen glede na idejo,
* ustreznosti vizualizacije za VR ali AR kontekst,
* razumevanja uporabniške izkušnje v prostoru,
* kakovosti opisov scen,
* pravilne oddaje v Git repozitorij.

---

Če želiš, lahko:

* dodam **primer promptov za NanoBanana / AI generiranje scen**,
* ali pripravim **rubriko ocenjevanja (točkovnik)** za vaje.
