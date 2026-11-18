# Filtro de candidatos Catho — PudiMarin

Script do Tampermonkey que funciona na área de empresa da Catho. **Todo dia**, no horário que você
escolher, ele faz isto sozinho:

1. abre **Minhas vagas** e entra nos **inscritos** de cada vaga ativa de **Auxiliar de Cozinha** e de
   **Atendente de Delivery**, passando por todas as páginas. Vagas desativadas ficam de fora (dá para
   incluir em ⚙ Ajustes). O script **nunca** entra na busca do banco de currículos (a lupa "116.184 currículos");
2. lê a cidade e o bairro de cada candidato (exemplo: "São Bernardo do Campo, SP - Jardim da represa");
3. abre o **Google Maps** numa aba em segundo plano, do mesmo jeito que você faz na mão, e lê o tempo
   de **transporte público** do bairro até a loja da vaga, saindo num dia útil às 8h. A aba fecha sozinha no fim;
4. se der até **45 minutos**, dá **👍** em "Avalie", abre **contatos** para pegar o WhatsApp e **avisa
   você** com uma notificação no Windows.

Quem já tem avaliação (👍 ou 👎 dado por você) fica de fora: o script não mexe. Também não dá 👍 duas
vezes na mesma pessoa.

Os candidatos **bloqueados pelo plano gratuito** ("Este candidato foi recomendado pela nossa IA! Assine…")
aparecem sem nome e sem "Avalie". Esses ficam de fora, porque não dá para saber quem são nem avaliar.

Sobre o WhatsApp: se o botão "Ver WhatsApp" do cartão já trouxer o número, o script usa esse número. Se não
trouxer, abre "contatos", e só de quem ganhou 👍. A Catho avisa que o plano gratuito tem limite de mensagens
por vaga. Se notar que "contatos" também está gastando esse limite, desmarque
**⚙ Ajustes → Pegar WhatsApp**.

## Lojas

| Vaga | Loja | Endereço |
|---|---|---|
| Auxiliar de Cozinha | Rudge Ramos | Av. Min. Osvaldo Aranha, 232 - Loja 4 - Vila Franca, São Bernardo do Campo - SP, 09626-000 |
| Atendente de Delivery | Vergueiro | Av. Senador Vergueiro, 2123 - Lj 1 - Rudge Ramos, São Bernardo do Campo - SP, 09726-253 |
| Atendente de Delivery | Nova Petrópolis | Av. Francisco Prestes Maia, 957 - Lj 14 - Centro, São Bernardo do Campo - SP, 09770-000 |

O candidato a atendente é comparado com as duas lojas e fica com a mais perto.

O script busca as lojas pelo **endereço**, e não pelo nome. Buscar "Doces Pudimarin - Pudim e Cookie
(Rudge Ramos)" no Google Maps cai na loja **Vergueiro**, porque ela fica no bairro Rudge Ramos.

## 1. Instalar (uma vez)

Com o Tampermonkey já instalado no navegador, abra este link e clique em **Instalar** (ou **Atualizar**):

https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/filtro-curriculos/filtro-catho.user.js

## 2. Primeira verificação (conferência)

1. Entre na Catho e abra você mesmo os inscritos de uma das vagas, uma vez só. Assim o script aprende o
   endereço da lista de inscritos e passa a abrir as outras vagas direto pelo número delas. Se você pular
   este passo, ele tenta achar o caminho sozinho.
2. Volte para **Minhas vagas** e clique em **Verificar agora** no painel **🍮 Filtro PudiMarin**,
   no canto de baixo da tela.
3. Abre uma aba nova, que vai sozinha para as vagas e os candidatos.
4. Na primeira vez, **antes de clicar**, ele marca com um quadrado vermelho o 👍 de quem está perto e pergunta
   se está certo.
   - Se o quadrado estiver mesmo no 👍 dessas pessoas, clique em **Sim, pode dar 👍**. Daí em diante ele faz isso sozinho.
   - Se estiver errado, clique em **Não, está errado**. Depois clique em **Diagnóstico** e cole o resultado
     no chat com o Claude.

## 3. Todo dia

- A verificação roda no horário de **⚙ Ajustes → Verificar todo dia** (o padrão é 9h).
- Para isso, o **navegador precisa estar aberto com alguma aba da Catho**. Deixe uma aba fixada
  com "Minhas vagas". Se o computador estiver desligado no horário, a verificação roda assim que
  você abrir a Catho de novo naquele dia.
- Ela acontece numa aba que abre e fecha sozinha. No fim chega a notificação
  **"Catho: N candidatos perto, com 👍"**, com nome, vaga, loja, tempo de ônibus e WhatsApp.
- Se algo der errado (por exemplo, a Catho pedir login de novo), chega uma notificação dizendo o
  que houve. Ele tenta de novo 2 horas depois.
- **⏹ Parar**: enquanto a verificação roda, o painel mostra esse botão, em qualquer aba da Catho. Ao clicar,
  ela para na hora, sem dar mais nenhum 👍, e só volta a rodar sozinha no dia seguinte. Para desligar de vez,
  desmarque **⚙ Ajustes → Verificar todo dia**.

## O painel

- **Até 45 min**: quem está perto, com a loja, o tempo de ônibus e o WhatsApp (o link abre a conversa).
  "👍 18/11" quer dizer que o filtro deu o like nesse dia. "já avaliado" quer dizer que você já tinha avaliado a pessoa.
- **Longe**: passou do limite.
- **Pendentes**: falta alguma coisa. Pode ser o bairro (só aparece a cidade) ou a vaga não identificada,
  e aí aparecem botões para escolher.
- **Copiar lista**: copia o resultado pronto para colar no WhatsApp (nome, vaga, endereço da loja e WhatsApp).
- **Baixar planilha**: baixa tudo em CSV, que abre no Excel.
- **⚙ Ajustes**: limite em minutos, horário de saída usado no cálculo (padrão 8h de um dia útil),
  horário da verificação diária e se deve abrir "contatos".
- **ver no Maps**: abre no Google Maps a mesma rota que o filtro consultou.

## Google Maps

- Cada bairro é consultado uma vez só para cada loja. Candidatos do mesmo bairro aproveitam a mesma consulta.
- Uma aba do Google Maps abre em segundo plano, consulta as rotas uma por uma, sem pressa, e fecha
  sozinha. As abas do Maps que você mesmo abre não são tocadas.
- Se o Google desconfiar e pedir para confirmar que você não é um robô, o filtro avisa no painel. Abra o
  Google Maps, confirme e clique em **tentar de novo**.
- Opcional: se quiser mais velocidade, dá para colar em **⚙ Ajustes** uma chave da Routes API do Google
  (Google Cloud → APIs e serviços → Routes API → Credenciais). Com a chave, o filtro usa a API em vez da
  aba do Maps. Sem chave, tudo funciona normalmente.

Quando você mesmo abre os candidatos de uma vaga, o painel também mostra o tempo de ônibus deles.
A vaga é reconhecida pelo título da página.

## Se algo não funcionar

A Catho pode mostrar os dados de um jeito que o script ainda não conhece. Nesse caso:

1. deixe aberta a página onde ele parou;
2. clique em **Diagnóstico** no painel;
3. cole o resultado no chat com o Claude.

O diagnóstico copia só a estrutura da página. Nomes, telefones e endereços saem trocados por `xxxx` e `9999`.
