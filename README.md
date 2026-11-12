🎙️ Ensaio 🎙️

Player de música para o celular, feito para estudar repertório: toque seus arquivos de áudio, acompanhe a letra sincronizada e repita ou desacelere os trechos difíceis.

Tudo roda no navegador, sem build nem dependências. Nenhuma música, letra ou anotação sai do seu aparelho.

Funcionalidades

Músicas e playlists

Adicione arquivos de áudio direto do celular (MP3, M4A e outros formatos que o navegador toque)
Busca por nome ou por trecho da letra, sem diferença de maiúsculas e acentos; tocar a partir da busca usa só os resultados como fila
Lista em páginas de 10, 20 ou 50 músicas (o app nunca desenha a lista inteira de uma vez)
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
Tema claro, escuro ou automático (segue o celular), escolhido no ícone do cabeçalho
Tela acesa enquanto a música toca

Anotações

Observações gerais por música (tom, capotraste, estrutura)
Anotações presas a um verso, como “entra a segunda voz”

Backup e troca de celular

Exportar dados: um arquivo .json pequeno com letras e tempos, observações, anotações nos versos e playlists (os áudios não vão junto, para o arquivo continuar leve)
Importar dados: antes de mudar algo, mostra o que vai acontecer. Músicas com o mesmo nome recebem a letra do arquivo; as que ainda não estão no aparelho ficam “esperando o áudio” e a letra entra sozinha quando você adiciona um áudio com o mesmo nome, inclusive na posição certa da playlist

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

O app limita os áudios a 1 GB (cerca de 100 a 200 músicas em MP3), já que é feito para o repertório em ensaio, não para guardar uma coleção. O fim da aba Músicas mostra quanto foi usado e quanto falta; músicas que passariam do limite não são adicionadas. O limite fica na constante STORAGE_LIMIT em js/app.js.

Limpar os dados do navegador apaga tudo. Antes, use Exportar dados (fim da aba Músicas).
No iPhone, o Safari pode apagar dados de sites pouco usados. Abrir o app com frequência ajuda.
Os dados não passam sozinhos de um endereço para outro nem de um celular para outro. Para levar tudo, use Exportar dados, depois Importar dados no destino, e adicione os áudios com os mesmos nomes de arquivo.
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

Observações e anotações não entram no .lrc, porque o formato não tem lugar para elas. Para levá-las junto, use Exportar dados.

Arquivo de dados (.json)

```json
{
 "app": "ensaio", "kind": "dados", "version": 1,
 "exportedAt": "2026-11-12T10:00:00.000Z",
 "songs": [
  { "title": "Nome da música", "notes": "Tom de Ré", "duration": 212.4,
    "lyrics": [ { "text": "Primeiro verso", "t": 12.4, "note": "entra a segunda voz" } ] }
 ],
 "playlists": [ { "name": "Ensaio de sábado", "songs": ["Nome da música"] } ]
}
```

Na importação, as músicas são ligadas pelo título, sem diferença de maiúsculas, acentos e “_”.
