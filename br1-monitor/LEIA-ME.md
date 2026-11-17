# BR1 Monitor de servidores

Fica de olho na lista **SERVERS** da Kill Race do BR1 e mostra uma notificação do Windows:

- **ABRIU SA #1 - MilitaryBase $0.25** quando um servidor novo aparece
- **FECHOU EU #6 - MilitaryBase $1** quando um servidor some da lista

O monitor roda **dentro da aba do site, no seu navegador**.
O site recusa (erro 403) consultas feitas por programas fora do navegador, como o CMD ou o PowerShell.

## Como usar (Chrome ou Edge)

1. Abra a página da kill race:
   https://www.br1game.com/kill-race/info/0074b0b7-a886-4f27-9a15-971052cbc158
2. Abra o código do monitor em outra aba, aperte `Ctrl+A` e depois `Ctrl+C`:
   https://raw.githubusercontent.com/Red0Dev/claude/claude/keen-cerf-kli3yh/br1-monitor/br1-monitor.js
3. Volte na aba da kill race, aperte `F12` e clique na aba **Console**.
4. Cole com `Ctrl+V` e aperte `Enter`.
   Na primeira vez o navegador bloqueia a colagem e pede para você digitar uma frase,
   por exemplo `allow pasting` ou `permitir colar`. Digite exatamente o que ele pedir, aperte Enter e cole de novo.
5. Feche o F12. Vai aparecer um painel preto no canto inferior direito da página.
   Clique em **Ativar avisos** e depois em **Permitir**. Deve chegar uma notificação de teste.

Deixe essa aba aberta. Ela pode ficar em segundo plano ou com a janela minimizada.

- `_` minimiza o painel.
- `x` para o monitor.
- Se você recarregar a página (F5), o monitor para. Para religar, repita os passos 3 e 4.

## Dicas

- **Economia de memória do Chrome:** ela pode "congelar" abas paradas.
  Vá em `chrome://settings/performance` e adicione `www.br1game.com` em "Sempre manter estes sites ativos".
- **Avisos bloqueados:** se o botão mostrar "Avisos bloqueados", clique no cadeado ao lado do endereço do site,
  mude **Notificações** para Permitir e recarregue a página.
- **Ligar sozinho:** com a extensão Tampermonkey, você pode instalar o mesmo arquivo como userscript.
  Assim o monitor liga sozinho sempre que você abre o site.

## Como funciona

A página da kill race busca a lista de servidores em `/api/game/killrace/info/<id-da-race>` (campo `servers`).
O monitor faz essa mesma consulta a cada 30 segundos, de dentro da página, e compara com a consulta anterior.

- Se mudarem mais de 3 servidores de uma vez, chega uma notificação só, com a lista.
- Se o site falhar 3 vezes seguidas, chega um aviso, e o monitor continua tentando.
  Enquanto isso, nenhum servidor é dado como fechado por engano.
