# BR1 Monitor de servidores

Fica de olho na lista **SERVERS** da Kill Race do BR1 e mostra uma notificação do Windows:

- **ABRIU SA #1 - MilitaryBase $0.25** quando um servidor novo aparece
- **FECHOU EU #6 - MilitaryBase $1** quando um servidor some da lista

O monitor roda **dentro da aba do site, no seu navegador**.
O site recusa (erro 403) consultas feitas por programas fora do navegador, como o CMD ou o PowerShell.

## Instalação com Tampermonkey (Chrome ou Edge)

1. **Instale a extensão Tampermonkey**
   - Chrome: https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo
   - Edge: https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd
2. **Libere scripts de usuário** (a extensão só funciona com isso ligado)
   - Chrome: abra `chrome://extensions`, clique em **Detalhes** no Tampermonkey e ligue **"Permitir scripts do usuário"**.
     Se essa opção não aparecer, ligue o **Modo do desenvolvedor**, no canto superior direito da mesma página.
   - Edge: abra `edge://extensions` e ligue o **Modo de desenvolvedor**, na barra da esquerda.
3. **Instale o script**: abra o link abaixo. O Tampermonkey mostra uma tela de instalação. Clique em **Instalar**.
   https://raw.githubusercontent.com/Red0Dev/claude/claude/keen-cerf-kli3yh/br1-monitor/br1-monitor.user.js
4. **Abra o site**: https://www.br1game.com/kill-race/info/0074b0b7-a886-4f27-9a15-971052cbc158
   Aparece um painel preto no canto inferior direito.
   Clique em **Ativar avisos** e depois em **Permitir**. Deve chegar uma notificação de teste.

A partir daí o monitor liga sozinho sempre que você abrir qualquer página do br1game.com.
Basta deixar uma aba do site aberta, que pode ficar em segundo plano.

## O painel

- O título mostra quantos servidores estão abertos.
- `_` minimiza o painel. Ele lembra disso na próxima vez. `+` mostra de novo.
- `x` para o monitor só naquela aba, até você recarregar a página.
- Se houver várias abas do site abertas, só uma faz a checagem. Você recebe cada aviso uma vez só.
- Se um servidor abrir ou fechar enquanto o navegador estava fechado (até 10 minutos), você é avisado quando voltar.

## Dicas

- **Economia de memória do Chrome:** ela pode "congelar" abas paradas.
  Vá em `chrome://settings/performance` e adicione `www.br1game.com` em "Sempre manter estes sites ativos".
- **Avisos bloqueados:** se o botão mostrar "Avisos bloqueados", clique no cadeado ao lado do endereço do site,
  mude **Notificações** para Permitir e recarregue a página.
- **Desligar de vez:** clique no ícone do Tampermonkey e desative ou exclua o "BR1 Monitor de servidores".
- **Sem Tampermonkey:** você também pode colar o conteúdo do arquivo no Console (F12) da página do site.
  Nesse caso ele para quando a página é recarregada.

## Como funciona

A página da kill race busca a lista de servidores em `/api/game/killrace/info/<id-da-race>` (campo `servers`).
O monitor faz essa mesma consulta a cada 30 segundos, de dentro da página, e compara com a última lista conhecida.

- Se mudarem mais de 3 servidores de uma vez, chega uma notificação só, com a lista.
- Se o site falhar 3 vezes seguidas, chega um aviso, e o monitor continua tentando.
  Enquanto isso, nenhum servidor é dado como fechado por engano.
- Se você estiver numa página de outra kill race, o monitor acompanha a race daquela página.
