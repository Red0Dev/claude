# BR1 Monitor de servidores

Fica de olho nos servidores de **todas as Kill Races ao vivo** do BR1 e mostra uma notificação do Windows:

- **ABRIU SA #1 - MilitaryBase $0.25** quando um servidor novo aparece
- **FECHOU EU #6 - MilitaryBase $1** quando um servidor some da lista

Quando uma kill race termina e outra começa, inclusive na semana seguinte, ele passa a seguir a nova sozinho.
A notificação diz de qual race é o servidor.

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
4. **Abra o site**: qualquer página do https://www.br1game.com serve.
   Aparece um painel preto no canto inferior direito.
   Clique em **Ativar avisos** e depois em **Permitir**. Deve chegar uma notificação de teste.

A partir daí o monitor liga sozinho sempre que você abrir qualquer página do br1game.com.
Basta deixar uma aba do site aberta, que pode ficar em segundo plano.

## O painel

- **Cabeçalho:** quantos servidores estão abertos, somando todas as kill races ao vivo.
  - A barrinha embaixo mostra quanto falta para a próxima checagem.
  - A borda fica verde quando está tudo certo e amarela quando o site não responde.
- **Aba Ao vivo:** os servidores abertos, separados por race, com quanto tempo falta para cada race acabar.
  Cada região tem uma cor: US azul, EU roxo, SA amarelo, SEA rosa e BR verde-água.
  Servidores que abriram nos últimos 10 minutos ganham a etiqueta **NOVO**.
- **Aba Atividade:** histórico do que abriu e fechou. O histórico fica salvo mesmo se você recarregar a página.
  O número verde mostra quantas mudanças você ainda não viu.
- **Sino:** silencia ou religa as notificações do Windows. O painel continua atualizando.
- **Setinha ou Esc:** minimiza o painel para uma pílula pequena, com o número de servidores. Clique nela para abrir de novo.
- **Clique na notificação:** leva você para a aba do site.
- **Várias abas do site:** só uma faz a checagem. Você recebe cada aviso uma vez só.
- **Navegador fechado:** se um servidor abrir ou fechar nesse meio tempo (até 10 minutos), você é avisado quando voltar.

## Dicas

- **Economia de memória do Chrome:** ela pode "congelar" abas paradas.
  Vá em `chrome://settings/performance` e adicione `www.br1game.com` em "Sempre manter estes sites ativos".
- **Avisos bloqueados:** se o botão mostrar "Avisos bloqueados", clique no cadeado ao lado do endereço do site,
  mude **Notificações** para Permitir e recarregue a página.
- **Desligar de vez:** clique no ícone do Tampermonkey e desative ou exclua o "BR1 Monitor de servidores".
- **Sem Tampermonkey:** você também pode colar o conteúdo do arquivo no Console (F12) da página do site.
  Nesse caso ele para quando a página é recarregada.

## Como funciona

A página de kill races do site busca a lista de races em `/api/game/killrace/active`.
Cada race vem com a fase (Live, Upcoming ou Completed) e os servidores dela.
O monitor faz essa mesma consulta a cada 30 segundos, de dentro da página.
Ele junta os servidores das races ao vivo e compara com a última lista conhecida.
Races que ainda não começaram são ignoradas até ficarem ao vivo.

- Se mudarem mais de 3 servidores de uma vez, chega uma notificação só, com a lista.
- Se o site falhar 3 vezes seguidas, chega um aviso, e o monitor continua tentando.
  Enquanto isso, nenhum servidor é dado como fechado por engano.
- Quando uma race termina, os servidores dela aparecem como FECHOU. A exceção são os que também estão em outra race ao vivo.
