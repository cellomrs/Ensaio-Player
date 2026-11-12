🎙️ Ensaio 🎙️

Player de música para o celular, feito para estudar repertório: toque seus arquivos de áudio, acompanhe a letra sincronizada e repita ou desacelere os trechos difíceis.

Tudo roda no navegador, sem build nem dependências. Nenhuma música, letra ou anotação sai do seu aparelho.

Funcionalidades

Músicas e playlists

Adicione arquivos de áudio direto do celular (MP3, M4A e outros formatos que o navegador toque)
Monte playlists com o repertório na ordem do ensaio
Ao terminar uma música, a próxima começa sozinha
Controles na tela de bloqueio e nos fones, quando o celular permite

Letras

Letra rolando junto com a música, com o verso atual destacado
Toque num verso para pular para ele
Sincronização manual: dê play e toque em Marcar linha no começo de cada verso
Ajuste fino dos tempos sem digitar: escolha um verso e use os botões −10 s, −5 s, −1 s, +1 s, +5 s e +10 s para ele acender antes ou depois. Dá para ajustar só esse verso, ele e todos os seguintes, ou a letra toda. A cada toque a música volta 2 s antes do verso para você conferir, e Cancelar desfaz tudo
Importação e exportação de arquivos .lrc

Ferramentas de ensaio

Velocidade de 0,5× a 1,25× sem mudar o tom
Repetição de trecho (A–B)
Botões de −5 s e +5 s
Três tamanhos de letra, para ler de longe na estante
Tela acesa enquanto a música toca

Anotações

Observações gerais por música (tom, capotraste, estrutura)
Anotações presas a um verso, como “entra a segunda voz”

Ajuda

Manual de uso completo dentro do próprio app
Como usar

Abra a página no navegador do celular e toque em Adicionar músicas. O manual completo está na aba Ajuda do app.

Para corrigir um verso fora de tempo, abra o player, toque em Sincronizar e escolha Ajustar tempos (também tem esse item no menu Letra).

Publicar a sua cópia (grátis)

O app usa arquivos estáticos, então qualquer hospedagem de site estático serve. Publique a pasta inteira, preservando a estrutura de arquivos.

GitHub Pages

Faça um fork deste repositório (ou crie um novo com todos os arquivos do projeto).
Vá em Settings → Pages.
Em Source, escolha a branch main e a pasta / (root).
Em poucos minutos o app estará em https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/.

Também funciona no Netlify Drop ou no Cloudflare Pages, arrastando a pasta do projeto.

O endereço precisa ser HTTPS para o armazenamento e os controles de mídia funcionarem. Todas as opções acima já usam HTTPS.

Onde ficam os dados

Músicas, letras, anotações e playlists ficam no IndexedDB do navegador, no aparelho e no endereço onde foram criadas.

Limpar os dados do navegador apaga tudo. Exporte antes as letras sincronizadas.
No iPhone, o Safari pode apagar dados de sites pouco usados. Abrir o app com frequência ajuda.
Os dados não passam de um endereço para outro nem de um celular para outro. Para levar uma letra, exporte o .lrc e importe no destino.
Estrutura do projeto

```text
index.html
css/
  styles.css
js/
  app.js
```

Tecnologia
HTML, CSS e JavaScript puros, sem build e sem dependências
IndexedDB para guardar áudio e letras
Media Session API para os controles na tela de bloqueio
Screen Wake Lock API para manter a tela acesa
Web Share API para compartilhar o arquivo .lrc
Fontes: Atkinson Hyperlegible e Bricolage Grotesque, via Google Fonts
Formato .lrc

Cada linha sincronizada começa com o tempo entre colchetes:

[ti:Nome da música]
[00:12.40]Primeiro verso da letra
[00:17.85]Segundo verso da letra

Observações e anotações não entram no .lrc, porque o formato não tem lugar para elas.
