# Respostas PudiMarin — WhatsApp Web

Script do Tampermonkey, separado do filtro da Catho, que ajuda a responder os candidatos no **WhatsApp Web**.

Ao abrir uma conversa, aparece um quadro pequeno **🍮 PudiMarin · respostas** no topo da conversa, à direita.
Ele mostra quem é a pessoa e a resposta sugerida. **Todas as respostas ▾** abre a lista completa. Clique no
título do quadro para recolher. Um clique numa resposta coloca o texto na caixa de mensagem; **você confere e aperta
Enter**. O script nunca envia nada sozinho, porque o WhatsApp bane números que mandam mensagens automáticas.

## Instalar

Com o Tampermonkey instalado, abra o link e clique em **Instalar**:

https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/respostas-whatsapp/respostas-whatsapp.user.js

## O que ele faz

- **De que é a conversa.** Se você já mandou a mensagem da vaga da Catho, ele mostra a vaga e a loja: Auxiliar
  de Cozinha (Rudge Ramos) ou Atendente (Vergueiro ou Nova Petrópolis, pelo endereço da mensagem). Se o
  assunto é freelance, mostra "Interessado no freelancer".
- **Sugestão de resposta**, pela última mensagem da pessoa:
  - "tenho interesse" depois da mensagem da vaga da Catho → **Tem interesse → próxima etapa**;
  - "não tenho interesse", "já arrumei"… → **Sem interesse → agradecer**;
  - pergunta pela vaga de freelancer ou de atendente ("saber mais…") → **Vaga disponível → pedir currículo**;
  - pergunta se a vaga de freelancer ainda está disponível → **Está disponível → deixar currículo**;
  - quer se candidatar sem dizer a vaga ("Quero me candidatar para a vaga") → **Qual vaga?**
    ("Boa tarde, para qual vaga seria?");
  - fala em freelance sem dizer o dia, ou manda currículo sem dizer a vaga → **Qual dia? (dom, seg ou ter)**;
  - manda o currículo (PDF) dizendo a vaga ou o dia → **Recebi o currículo**;
  - fala em **Auxiliar de Cozinha ou "Auxiliar de produção"** (é a mesma vaga) → **Vaga de Auxiliar de Cozinha →
    pedir currículo** (descrição da vaga da Rudge Ramos). Se mostrar interesse depois → **Pedir o currículo**;
  - depois da descrição do freelancer, diz o dia → **Pedir o currículo**; só diz que tem interesse → **Qual dia?**;
  - responde o bairro que você pediu → **Obrigada pelo bairro**.
- **Todas as respostas ficam em botões**, inclusive as 3 mensagens das vagas CLT e a mensagem do freelancer
  em duas versões (pedindo currículo ou disponibilidade).
- **{saudacao}** vira "Bom dia", "Boa tarde" ou "Boa noite" pelo horário. **{nome}** vira o primeiro nome:
  do contato salvo, do "~Nome" do perfil ou do "me chamo…" da mensagem.
- Em **Pedir o bairro**, troque o **[cidade]** pela cidade que está no currículo antes de enviar.
- **✏️ Editar respostas** muda qualquer texto. **Voltar ao original** desfaz.

Textos escritos no estilo das suas anotações, para os casos que faltavam: "Vaga de Auxiliar de Cozinha → pedir
currículo", "Pedir o currículo", "Obrigada pelo bairro", "Tem interesse → próxima etapa" e "Sem interesse →
agradecer". Ajuste à vontade em ✏️ Editar.

## Se algo não funcionar

O WhatsApp Web muda de vez em quando. Se o quadro não aparecer, não reconhecer a conversa ou o texto não
entrar na caixa, o texto já fica copiado: clique na caixa e aperte **Ctrl+V**. Depois clique em
**Diagnóstico** e cole o resultado no chat com o Claude. O diagnóstico copia só a estrutura da página, sem
os textos das conversas.
