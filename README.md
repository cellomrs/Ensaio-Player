# 🎙️ Ensaio 🎙️

Player de música para o celular, feito para estudar repertório: toque seus arquivos de áudio, acompanhe a letra sincronizada (com cifras), repita ou desacelere os trechos difíceis e leve o repertório para o palco.

Tudo roda no navegador, sem build nem dependências. Nenhuma música, letra ou anotação sai do seu aparelho.

## Novidades

| Versão | O que mudou |
| --- | --- |
| **2.7** | **Versões por naipe** (kits do coral): Tutti, Soprano, Contralto, Tenor, Baixo… como uma música só, com uma letra. Troca de voz no player no mesmo ponto da música, agrupamento automático pelo nome do arquivo e **Meu naipe**. |
| **2.6** | Importação mais fácil: **Escolher áudio** ao lado de cada letra esperando (arquivo com qualquer nome), **Usar letra importada…** no menu da música e **Trocar o áudio…** sem perder letra, cifras, partes e anotações. A duração aparece assim que o áudio é adicionado. |
| **2.5** | **Modo palco** (tela cheia só com a letra e a próxima música) e **pedal de virar página / teclado**. Duração total do repertório nas playlists. |
| **2.4** | **Marca-texto** em versos ou trechos, com nomes para as cores e legenda no player. |
| **2.3** | **Partes da música** (Intro, Verso, Refrão…) para pular e repetir, e **cifras sobre a letra** com transposição. |
| **2.2** | **Tutorial com imagens**, aberto pela Ajuda sem parar a música. |
| 2.1 e antes | Editar um verso segurando o dedo, “ao terminar a música” (pausar, seguir, repetir), app instalável e sem internet, tema claro/escuro, busca e páginas, limite de 1 GB, exportar/importar dados e ajuste fino dos tempos. |

## Funcionalidades

### Músicas e playlists

- Adicione arquivos de áudio direto do celular (MP3, M4A e outros formatos que o navegador toque); a duração aparece na hora
- Busca por nome ou por trecho da letra, sem diferença de maiúsculas e acentos; tocar a partir da busca usa só os resultados como fila
- Lista em páginas de 10, 20 ou 50 músicas (o app nunca desenha a lista inteira de uma vez)
- Playlists com o repertório na ordem do ensaio e a duração total
- O que acontece ao terminar uma música: pausar, seguir a fila até o fim (padrão), repetir a música ou repetir a fila toda
- Trocar o áudio de uma música (arquivo errado ou gravação melhor), mantendo letra, cifras, partes, marca-texto e anotações
- **Versões por naipe** (kits do coral): várias gravações da mesma música (Tutti, Soprano, Contralto, Tenor, Baixo, Piano) com uma letra só. Arquivos como `Ave Maria - Soprano.mp3` são agrupados ao adicionar; no player, os botões de versão trocam a voz no mesmo ponto da música, e **Meu naipe** abre sempre a sua voz
- Controles na tela de bloqueio e nos fones, quando o celular permite

### Letras e cifras

- Letra rolando junto com a música, com o verso atual destacado; toque num verso para pular para ele
- Sincronização manual: dê play e toque em **Marcar linha** no começo de cada verso
- Ajuste fino dos tempos sem digitar: escolha um verso e use −10 s, −5 s, −1 s, +1 s, +5 s e +10 s para ele acender antes ou depois. Vale para esse verso, para ele e os seguintes, ou para a letra toda. A cada toque a música volta 2 s antes do verso para você conferir, e Cancelar desfaz tudo
- Segure um verso para corrigir o texto, os acordes, a cor ou a anotação, sem perder o tempo dele nem abrir a letra toda
- Cifras sobre a letra: cole os acordes entre colchetes (`[D]Na estrada`) ou no formato dos sites de cifra (acordes na linha de cima). Transposição por música, de meio em meio tom, e opção de esconder as cifras para quem só canta
- Importação e exportação de arquivos .lrc

### Ferramentas de ensaio

- Velocidade de 0,5× a 1,25× sem mudar o tom
- Repetição de trecho (A–B)
- **Partes da música** (Intro, Verso, Refrão…): marque onde cada uma começa, toque para ir direto a ela e segure para repetir a parte inteira
- Botões de −5 s e +5 s e três tamanhos de letra
- Tema claro, escuro ou automático (segue o celular), escolhido no ícone do cabeçalho
- Tela acesa enquanto a música toca

### No palco

- **Modo palco**: tela cheia só com a letra bem grande (com cifras e marca-texto), a posição na fila e a próxima música no alto. Toque na letra para mostrar os controles; toque nas bordas para trocar de música, que fica pronta, sem tocar, para a banda entrar junto. Tocar ou segurar um verso não faz nada, para evitar toques sem querer, e a tela fica acesa mesmo com a música parada
- **Pedal de virar página (Bluetooth) e teclado**: os dois botões do pedal podem ir de parte em parte, tocar/pausar ou trocar de música. Atalhos: Espaço (tocar/pausar), ← → (5 s), Shift + ← → ou P/N (música), L (repetir a parte), F (modo palco) e ? (lista de atalhos)

### Anotações

- Observações gerais por música (tom, capotraste, estrutura), sempre à vista no player
- Anotações presas a um verso, como “entra a segunda voz”
- **Marca-texto**: pinte o verso inteiro ou só um trecho com quatro cores, e dê nome às cores (“Minha voz”, “2ª voz”, “Coro”) para aparecer uma legenda no player

### Backup e troca de celular

- **Exportar dados**: um arquivo .json pequeno com letras e tempos, cifras e tom, partes, marca-texto e nomes das cores, observações, anotações e playlists. Os áudios não vão junto, para o arquivo continuar leve
- **Importar dados**: antes de mudar algo, mostra o que vai acontecer. Músicas com o mesmo nome recebem a letra do arquivo. As que ainda não estão no aparelho ficam em **Esperando o áudio**:
  - um áudio com o mesmo nome recebe a letra sozinho, inclusive na posição certa da playlist;
  - arquivo com outro nome? Toque em **Escolher áudio** ao lado da letra;
  - a música já está no aparelho com outro nome? Use **⋯ → Usar letra importada…** nela.

### App instalável (PWA) e ajuda

- Instale na tela de início do celular: abre em tela cheia, com ícone próprio, e funciona sem internet
- Aviso “Nova versão disponível” quando o app é atualizado (só recarrega quando você toca em Atualizar, para não interromper uma música)
- Manual completo na aba **Ajuda** e **tutorial com imagens** das telas (`tutorial.html`), aberto pela Ajuda sem parar a música

## Como usar

Abra a página no navegador do celular e toque em **Adicionar músicas**. O manual completo está na aba **Ajuda**, e o tutorial com imagens fica no link do topo da Ajuda (ou direto em `tutorial.html`).

Atalhos para o dia a dia:

- **Verso fora de tempo:** no player, **Sincronizar → Ajustar tempos** (também está no menu **Letra**).
- **Palavra ou acorde errado:** segure o verso.
- **Estudar a sua voz no kit do coral:** adicione todos os arquivos do kit de uma vez, toque em **Agrupar** e escolha **Meu naipe** em **⋯ → Versões (naipe)…**.
- **Ensaiar só o refrão:** marque as partes com **+ Parte** e segure a parte → **Repetir esta parte**.
- **Tocar ao vivo:** ícone de tela cheia ao lado de **Letra** (modo palco). Pareie o pedal e escolha o que ele faz em **Ajuda → Pedal e teclado**.

## Publicar a sua cópia (grátis)

O app usa arquivos estáticos, então qualquer hospedagem de site estático serve. Publique a pasta inteira, preservando a estrutura de arquivos.

### GitHub Pages

1. Faça um fork deste repositório (ou crie um novo com todos os arquivos do projeto).
2. Vá em **Settings → Pages**.
3. Em **Source**, escolha a branch `main` e a pasta `/ (root)`.
4. Em poucos minutos o app estará em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

Também funciona no Netlify Drop ou no Cloudflare Pages, arrastando a pasta do projeto.

O endereço precisa ser HTTPS para o armazenamento, os controles de mídia, a instalação como app e a tela cheia funcionarem. Todas as opções acima já usam HTTPS. Abrindo o `index.html` direto do disco (`file://`), o app funciona, mas não fica instalável nem disponível sem internet.

### Publicar uma atualização

O service worker (`sw.js`) guarda os arquivos do app no aparelho. Ao publicar qualquer mudança em `index.html`, `tutorial.html`, `css/`, `js/` ou `img/`, aumente a `VERSION` no início do `sw.js` (por exemplo de `ensaio-v2.6` para `ensaio-v2.7`). Sem isso, quem já instalou continua vendo a versão antiga. Com isso, o app mostra “Nova versão disponível” e atualiza quando a pessoa tocar em **Atualizar**. As músicas e letras não são afetadas.

Se acrescentar um arquivo novo ao app (outro .js, .css ou imagem), inclua-o também na lista `SHELL` do `sw.js`. As imagens de `img/tutorial/` são a exceção: ficam guardadas quando a pessoa abre o tutorial.

Se mudar uma tela do app, vale refazer o print correspondente em `img/tutorial/` (390 × 844 px, escala 2, WebP).

## Onde ficam os dados

Músicas, letras, anotações e playlists ficam no IndexedDB do navegador, no aparelho e no endereço onde foram criadas. As preferências do aparelho (tema, músicas por página, “ao terminar”, cifras visíveis, nomes das cores, pedal e meu naipe) ficam no `localStorage`.

O app limita os áudios a 1 GB (cerca de 100 a 200 músicas em MP3), já que é feito para o repertório em ensaio, não para guardar uma coleção. O fim da aba Músicas mostra quanto foi usado e quanto falta; músicas que passariam do limite não são adicionadas. O limite fica na constante `STORAGE_LIMIT` em `js/app.js`.

- Limpar os dados do navegador apaga tudo. Antes, use **Exportar dados** (fim da aba Músicas).
- No iPhone, o Safari pode apagar dados de sites pouco usados. Instalar o app na tela de início evita isso.
- Os dados não passam sozinhos de um endereço para outro nem de um celular para outro. Para levar tudo, use **Exportar dados** e depois **Importar dados** no destino, e adicione os áudios (com os mesmos nomes de arquivo ou escolhendo cada um em **Escolher áudio**).

## Estrutura do projeto

```text
index.html
tutorial.html          tutorial com imagens (abre por cima do app ou sozinho)
manifest.webmanifest   dados do app instalável (nome, ícones, cores)
sw.js                  service worker: funcionamento sem internet e atualizações
css/
  styles.css
  tutorial.css         estilo do tutorial (usa as cores de styles.css)
js/
  app.js
img/
  logo.png             logo original (1254 px), fonte dos ícones; não é carregado pelo app
  logo-96.png          logo do cabeçalho e da Ajuda
  icon-192.png, icon-512.png                   ícones do app
  icon-maskable-192.png, icon-maskable-512.png ícones com margem para o recorte do Android
  apple-touch-icon.png  ícone do iPhone/iPad
  favicon-32.png        ícone da aba do navegador
  tutorial/             prints do tutorial (WebP, guardados pelo service worker quando vistos)
```

## Tecnologia

- HTML, CSS e JavaScript puros, sem build e sem dependências
- IndexedDB para guardar áudio e letras
- Media Session API para os controles na tela de bloqueio
- Screen Wake Lock API para manter a tela acesa
- Fullscreen API para o modo palco, e eventos de teclado para o pedal
- Web Share API para compartilhar o arquivo .lrc e o arquivo de dados
- Web App Manifest e Service Worker para instalar e usar sem internet
- Fontes: Atkinson Hyperlegible e Bricolage Grotesque, via Google Fonts (guardadas pelo service worker no primeiro acesso)

## Formato .lrc

Cada linha sincronizada começa com o tempo entre colchetes:

```text
[ti:Nome da música]
[00:12.40]Primeiro verso da letra
[00:17.85]Segundo verso da letra
```

Acordes, marca-texto, observações e anotações não entram no .lrc, porque o formato não tem lugar para eles. Para levá-los junto, use **Exportar dados**.

## Arquivo de dados (.json)

```json
{
 "app": "ensaio", "kind": "dados", "version": 1,
 "exportedAt": "2026-11-12T10:00:00.000Z",
 "markNames": { "y": "Minha voz", "g": "2ª voz" },
 "songs": [
  { "title": "Nome da música", "notes": "Tom de Ré", "duration": 212.4,
    "transpose": 2,
    "parts": [ { "t": 0, "name": "Intro" }, { "t": 12.4, "name": "Verso" }, { "t": 33.2, "name": "Refrão" } ],
    "lyrics": [ { "text": "Primeiro verso", "t": 12.4, "note": "entra a segunda voz",
                  "chords": [ { "i": 0, "c": "D" }, { "i": 9, "c": "G" } ],
                  "marks": [ { "a": 0, "b": 8, "k": "y" } ] } ] }
 ],
 "playlists": [ { "name": "Ensaio de sábado", "songs": ["Nome da música"] } ]
}
```

Na importação, as músicas são ligadas pelo título, sem diferença de maiúsculas, acentos e “_”. Quando o nome não bate, a letra fica esperando e pode ser ligada à mão (**Escolher áudio** ou **Usar letra importada…**).

Campos:

- `chords`: os acordes ficam à parte do texto (`i` é a posição do caractere no verso, `c` é o acorde), então a busca, o .lrc e a sincronização não são afetados.
- `transpose`: semitons escolhidos para a música (−11 a 11).
- `parts`: início (`t`, em segundos) e nome de cada parte.
- `marks`: trechos com marca-texto (`a` e `b`: começo e fim no texto; `k`: `y` amarelo, `g` verde, `p` rosa, `b` azul).
- `markNames`: nomes das cores.
- `versions`: nomes das versões da música (só informação; os áudios não vão no arquivo).

`parts`, `chords`, `transpose`, `marks`, `markNames` e `versions` são opcionais: arquivos exportados antes dessas versões continuam importando.
