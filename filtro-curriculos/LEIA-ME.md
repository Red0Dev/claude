# Filtro de candidatos Catho — PudiMarin

Script do Tampermonkey que funciona na área de empresa da Catho. Enquanto você abre as vagas e os
currículos, ele faz três coisas:

- lê nome, endereço e telefone de cada candidato;
- calcula no Google quanto tempo a pessoa leva **de ônibus** até cada loja da vaga dela, num dia útil às 8h;
- escolhe a loja mais perto e separa quem está dentro do limite que você definir.

O script não clica em nada e não abre currículos sozinho. Ele só lê o que você já abriu, então
não gasta visualizações do seu plano da Catho.

## Lojas

| Vaga | Loja | Endereço |
|---|---|---|
| Auxiliar de Cozinha | Rudge Ramos | Av. Min. Osvaldo Aranha, 232 - Loja 4 - Vila Franca, São Bernardo do Campo - SP, 09626-000 |
| Atendente de Delivery | Vergueiro | Av. Senador Vergueiro, 2123 - Lj 1 - Rudge Ramos, São Bernardo do Campo - SP, 09726-253 |
| Atendente de Delivery | Nova Petrópolis | Av. Francisco Prestes Maia, 957 - Lj 14 - Centro, São Bernardo do Campo - SP, 09770-000 |

O candidato a atendente é comparado com as duas lojas e fica com a mais perto. Se a mesma pessoa
se inscreveu nas duas vagas, ela é comparada com as três lojas.

## 1. Instalar (uma vez)

Com o Tampermonkey já instalado no navegador, abra este link e clique em **Instalar**:

https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/filtro-curriculos/filtro-catho.user.js

## 2. Criar a chave do Google (uma vez, uns 10 minutos)

O cálculo de ônibus é feito pelo Google Maps. Para isso, você precisa de uma chave sua.

1. Entre em https://console.cloud.google.com com sua conta Google e crie um projeto (por exemplo, "Filtro Catho").
2. Em **Faturamento**, vincule um cartão. O Google oferece uma cota grátis por mês, e cada
   candidato usa 1 consulta (cozinha) ou 2 (atendente).
3. Em **APIs e serviços → Biblioteca**, procure **Routes API** e clique em **Ativar**.
4. Em **APIs e serviços → Credenciais**, clique em **Criar credenciais → Chave de API**.
5. Abra a chave criada. Em **Restrições de API**, escolha **Restringir chave**, marque só a
   **Routes API** e salve.
6. Recomendado: em **Faturamento → Orçamentos e alertas**, crie um alerta de valor baixo (por exemplo, R$ 10).
   Assim você recebe um aviso se a conta passar disso.
7. Copie a chave (começa com `AIza…`). Na Catho, abra o painel do filtro, vá em **⚙ Ajustes** e cole a chave em **Chave Google**.

## 3. Usar

1. Entre na Catho, na área da empresa, e abra a lista de candidatos de uma vaga ou os currículos.
2. O painel **🍮 Filtro PudiMarin** fica no canto de baixo da tela. Clique no título para abrir ou fechar.
3. Em **⚙ Ajustes**, escolha o limite. O padrão é **45 minutos de ônibus**, e dá para trocar para km.
4. As abas separam os candidatos:
   - **Até 45 min**: dentro do limite, do mais perto para o mais longe, com a loja, o tempo e o WhatsApp.
     O WhatsApp já é um link que abre a conversa.
   - **Longe**: passou do limite.
   - **Pendentes**: falta alguma coisa. Pode ser só a cidade no endereço, a vaga que não foi
     identificada (aí aparecem botões para você escolher) ou um endereço que o Google não achou.
5. **Copiar lista** copia o resultado pronto para colar no WhatsApp: nome, vaga, endereço da loja e
   WhatsApp, separados por loja.
6. **Baixar planilha** baixa tudo em CSV, que abre no Excel.

A vaga é reconhecida pelo título da página ("Auxiliar de Cozinha", "Atendente…"). Se ela aparecer
errada, mude em **⚙ Ajustes → Vaga desta página**.

Os candidatos ficam guardados no navegador até você clicar em **Limpar**.

## Se nenhum candidato aparecer

A Catho pode mostrar os dados de um jeito que o script ainda não conhece. Nesse caso:

1. abra um currículo na Catho;
2. clique em **Diagnóstico** no painel;
3. cole o resultado no chat com o Claude.

O diagnóstico copia só a estrutura da página. Nomes, telefones e endereços saem trocados por `xxxx` e `9999`.
Com isso dá para ajustar o script.

Se um currículo estiver aberto e não tiver entrado na lista, clique em **Ler esta página**.
