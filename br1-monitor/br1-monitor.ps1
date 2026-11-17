<#
    BR1 - Monitor de servidores da Kill Race
    ----------------------------------------
    Fica olhando a lista "SERVERS" da kill race e mostra uma notificação
    do Windows quando um servidor ABRE ou FECHA.

    Como usar : dois cliques em "iniciar-monitor.bat"
    Para parar: feche a janela ou aperte Ctrl+C

    Opções (todas opcionais):
      -RaceUrl            link da kill race a monitorar
      -IntervaloSegundos  de quanto em quanto tempo checar (padrão: 30)
#>
param(
    [string]$RaceUrl = 'https://www.br1game.com/kill-race/info/0074b0b7-a886-4f27-9a15-971052cbc158',

    [ValidateRange(10, 3600)]
    [int]$IntervaloSegundos = 30,

    # Só para testes; normalmente não precisa mexer.
    [string]$ApiBase = 'https://www.br1game.com'
)

$ErrorActionPreference = 'Stop'
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$uuid = [regex]::Match($RaceUrl, '[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}').Value
if (-not $uuid) {
    Write-Host "Não encontrei o ID da kill race no link: $RaceUrl" -ForegroundColor Red
    exit 1
}
# Mesmo endereço que a própria página do jogo usa para montar a lista "SERVERS".
$apiUrl  = "$($ApiBase.TrimEnd('/'))/api/game/killrace/info/$uuid"
$logFile = Join-Path $PSScriptRoot 'br1-monitor.log'

# ---------------------------------------------------------------- utilidades

function Write-Log {
    param([string]$Texto, [ConsoleColor]$Cor = 'Gray')
    $linha = '[{0:dd/MM HH:mm:ss}] {1}' -f (Get-Date), $Texto
    Write-Host $linha -ForegroundColor $Cor
    try { Add-Content -LiteralPath $logFile -Value $linha -Encoding UTF8 } catch { }
}

$script:balao = $null

function Send-Notificacao {
    param([string]$Titulo, [string]$Texto)

    # 1) Notificação nativa do Windows 10/11 (aparece no canto da tela e fica na Central de Notificações)
    try {
        $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
        $t = [Security.SecurityElement]::Escape($Titulo)
        $b = [Security.SecurityElement]::Escape($Texto)
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual><audio src='ms-winsoundevent:Notification.Default'/></toast>")
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show(
            [Windows.UI.Notifications.ToastNotification]::new($xml))
        return
    } catch { }

    # 2) Plano B: balão do ícone da bandeja
    try {
        if (-not $script:balao) {
            Add-Type -AssemblyName System.Windows.Forms, System.Drawing
            $script:balao = New-Object System.Windows.Forms.NotifyIcon
            $script:balao.Icon    = [System.Drawing.SystemIcons]::Information
            $script:balao.Text    = 'BR1 Monitor'
            $script:balao.Visible = $true
        }
        $script:balao.ShowBalloonTip(10000, $Titulo, $Texto, [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        try { [console]::Beep(1000, 300) } catch { }
    }
}

function Get-Servidores {
    $resp = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 20 -UseBasicParsing -Headers @{ Accept = 'application/json' }

    if ($null -eq $resp -or $resp -is [string] -or $resp -is [array]) {
        throw 'a resposta do site não veio no formato esperado (talvez o site tenha mudado).'
    }
    $campos = @($resp.PSObject.Properties.Name)
    if ($campos -notcontains 'servers') {
        # A página trata "sem campo servers" como lista vazia (modo Global).
        if ($campos -contains 'begin' -or $campos -contains 'prize') { return ,([string[]]@()) }
        throw 'a resposta do site não tem a lista de servidores.'
    }

    $nomes = foreach ($s in @($resp.servers)) {
        if ($null -eq $s) { continue }
        if ($s -is [string]) { $s.Trim() }
        elseif (@($s.PSObject.Properties.Name) -contains 'name') { ([string]$s.name).Trim() }
        else { $s | ConvertTo-Json -Compress -Depth 3 }
    }
    return ,([string[]]@($nomes | Where-Object { $_ } | Sort-Object -Unique))
}

function Show-Mudancas {
    param([string]$Acao, [string]$AcaoPlural, [string[]]$Lista, [string]$Resumo, [ConsoleColor]$Cor)
    if ($Lista.Count -eq 0) { return }
    foreach ($s in $Lista) { Write-Log "$Acao $s" $Cor }
    if ($Lista.Count -le 3) {
        foreach ($s in $Lista) { Send-Notificacao "$Acao $s" $Resumo }
    } else {
        # Muitas mudanças de uma vez: uma notificação só, para não inundar a tela
        Send-Notificacao "$AcaoPlural $($Lista.Count) SERVIDORES" (($Lista -join "`n") + "`n" + $Resumo)
    }
}

# ---------------------------------------------------------------- loop principal

try { $Host.UI.RawUI.WindowTitle = 'BR1 Monitor de servidores' } catch { }
Write-Log "Monitor iniciado. Checando a cada $IntervaloSegundos segundos." Cyan
Write-Log "Kill race: $RaceUrl" DarkGray
Write-Log 'Para parar: feche esta janela ou aperte Ctrl+C.' DarkGray

$anterior = $null
$falhas   = 0

try {
    while ($true) {
        try {
            $atual = Get-Servidores

            if ($falhas -ge 3) {
                Write-Log 'Conexão com o site voltou.' Green
                Send-Notificacao 'BR1 Monitor' 'Conexão com o site voltou.'
            }
            $falhas = 0

            if ($null -eq $anterior) {
                Write-Log "Servidores abertos agora ($($atual.Count)):" Cyan
                foreach ($s in $atual) { Write-Log "   $s" White }
                Send-Notificacao 'BR1 Monitor ligado' "$($atual.Count) servidores abertos agora. Vou avisar quando abrir ou fechar algum."
            } else {
                $abriram  = [string[]]@($atual    | Where-Object { $anterior -notcontains $_ })
                $fecharam = [string[]]@($anterior | Where-Object { $atual    -notcontains $_ })
                $resumo   = "$($atual.Count) servidores abertos agora - $(Get-Date -Format 'HH:mm')"
                Show-Mudancas -Acao 'ABRIU'  -AcaoPlural 'ABRIRAM'  -Lista $abriram  -Resumo $resumo -Cor Green
                Show-Mudancas -Acao 'FECHOU' -AcaoPlural 'FECHARAM' -Lista $fecharam -Resumo $resumo -Cor Red
            }

            $anterior = $atual
            try { $Host.UI.RawUI.WindowTitle = "BR1 Monitor - $($atual.Count) servidores - checado $(Get-Date -Format 'HH:mm:ss')" } catch { }
        } catch {
            $falhas++
            $msg = $_.Exception.Message
            $status = 0
            try { $status = [int]$_.Exception.Response.StatusCode } catch { }
            if ($status -eq 403) { $msg = 'o site recusou o acesso (erro 403).' }
            Write-Log "Não consegui ler a lista ($falhas): $msg" Yellow
            if ($falhas -eq 3) {
                Send-Notificacao 'BR1 Monitor: sem conexão' 'Não consegui ler a lista de servidores 3 vezes seguidas. Continuo tentando.'
            }
        }

        Start-Sleep -Seconds $IntervaloSegundos
    }
} finally {
    if ($script:balao) { $script:balao.Visible = $false; $script:balao.Dispose() }
}
