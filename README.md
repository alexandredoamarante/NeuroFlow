# NeuroFlow — Dark Liquid Glass Edition

## Sobre o Projeto
O **NeuroFlow** é uma ferramenta de produtividade minimalista e de alta performance, projetada para quem busca foco absoluto e organização sem distrações. O projeto nasceu da necessidade de unir um sistema de notas hierárquico (estilo Obsidian/Zettelkasten) com ferramentas de gestão de tempo (Pomodoro) e tarefas (Checklist), tudo em uma interface única e esteticamente envolvente.

Esta versão **"Dark Liquid Glass"** redefine a experiência do usuário através de uma estética inspirada no *Frutiger Aero* e *VisionOS*, utilizando transparências profundas, reflexos realistas e tons sóbrios (pretos e cinzas) para criar um ambiente de trabalho digital sério e imersivo.

---

## Funcionalidades Principais

### 1. Sistema de Notas em Árvore (Mind Mapping)
- **Hierarquia Infinita:** Organize suas ideias em uma estrutura de árvore recursiva. Cada nota pode ter sub-notas, permitindo um detalhamento progressivo.
- **Visualização Estilizada:** Conexões visuais verticais inspiradas no Reddit e Obsidian facilitam a navegação em grandes conjuntos de dados.
- **Suporte a Mídia:** Adicione imagens via URL ou Upload diretamente nas notas.
- **Links [[ ]]:** Crie conexões mentais rápidas usando a sintaxe de colchetes duplos.
- **Navegação Global:** Botões de "Expandir Tudo" e "Recolher Tudo" para uma visão panorâmica ou focada.

### 2. Gestão de Imagens e Performance
- **Compressão Inteligente:** O NeuroFlow processa imagens no lado do cliente (Canvas API), comprimindo-as para garantir que o armazenamento local (LocalStorage) seja utilizado de forma eficiente sem sacrificar a qualidade visual.
- **Thumbnail Auto-Layout:** Todas as imagens na árvore são exibidas em thumbnails padronizados (240x160px), mantendo a interface limpa e organizada.
- **Image Viewer Imersivo:** Clique em qualquer imagem para expandi-la em um modal de vidro com desfoque de fundo, permitindo visualização em tamanho real.

### 3. Focus Timer (Pomodoro)
- **Interface Ocultável:** Minimize o timer para focar apenas nas notas ou mantenha-o visível para monitorar seu progresso.
- **Progresso Visual:** Anel de progresso SVG dinâmico que reflete o tempo restante com precisão cirúrgica.
- **Controle Total:** Defina durações personalizadas, pause e reinicie suas sessões de foco conforme necessário.

### 4. Checklist de Tarefas
- **Acompanhamento em Tempo Real:** Uma barra de progresso visual indica a porcentagem de conclusão das tarefas da lista.
- **Gestão Ágil:** Adicione e remova itens rapidamente com uma interface otimizada para velocidade.

---

## Diferenciais Técnicos
- **Privacidade Total:** Seus dados nunca saem do seu navegador. Todo o armazenamento é feito localmente via `LocalStorage`.
- **Zero Dependências:** Construído puramente com **Vanilla JavaScript**, garantindo carregamento instantâneo e leveza.
- **Sincronização Anti-Conflito:** Implementa um padrão de sincronização ativa que evita perda de dados durante operações simultâneas (ex: atualizar o checklist enquanto o timer está rodando).
- **Segurança Nativa:** Proteção rigorosa contra XSS através da manipulação segura do DOM (`textContent` e `createElement`).

---

## Como Usar
1. **Crie uma Tarefa:** Na página inicial, defina o nome e a cor da sua área de foco.
2. **Organize suas Notas:** Entre na tarefa e comece a adicionar notas. Use o botão `+` para criar sub-notas.
3. **Foque e Execute:** Ative o timer de 25 minutos e utilize o checklist para quebrar grandes tarefas em passos menores.
4. **Anexe Evidências:** Use o upload de imagens para manter referências visuais sempre à mão.

---
*NeuroFlow — Fluxo contínuo para mentes criativas.*
