# BR1 Monitor de servidores

Fica de olho na lista **SERVERS** da Kill Race do BR1 e mostra uma notificação do Windows:

- **ABRIU SA #1 - MilitaryBase $0.25** quando um servidor novo aparece
- **FECHOU EU #6 - MilitaryBase $1** quando um servidor some da lista

A janela também mostra tudo com horário e grava num arquivo `br1-monitor.log` na mesma pasta.

## Como usar

1. Coloque os arquivos `br1-monitor.ps1` e `iniciar-monitor.bat` na mesma pasta do seu PC.
2. Dê dois cliques em **`iniciar-monitor.bat`**.
3. Deixe a janela aberta (pode minimizar). Para parar, feche a janela ou aperte `Ctrl+C`.

Na primeira checagem aparece a notificação "BR1 Monitor ligado" com quantos servidores estão abertos.
Depois disso, você só recebe aviso quando algo muda.

> Se o Windows mostrar um aviso de segurança porque o arquivo veio da internet, clique com o botão direito nos dois arquivos,
> vá em **Propriedades** e marque **Desbloquear**.

## Opções

Você pode passar opções pelo CMD:

```bat
iniciar-monitor.bat -IntervaloSegundos 15
iniciar-monitor.bat -RaceUrl "https://www.br1game.com/kill-race/info/OUTRO-ID"
```

- `-IntervaloSegundos`: de quanto em quanto tempo checar. O padrão é 30 e o mínimo é 10.
- `-RaceUrl`: link de outra kill race para monitorar.

## Abrir junto com o Windows

Aperte `Win+R`, digite `shell:startup` e coloque ali um **atalho** para o `iniciar-monitor.bat`.

## Como funciona

A página da kill race busca a lista de servidores em
`https://www.br1game.com/api/game/killrace/info/<id-da-race>` (campo `servers`).
O script consulta esse mesmo endereço a cada 30 segundos e compara com a consulta anterior.
Se o site ficar fora do ar, ele avisa depois de 3 falhas seguidas e continua tentando.
Nesse meio tempo, nenhum servidor é dado como fechado por engano.
