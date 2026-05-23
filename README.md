# NeuroFlow — Dark Liquid Glass Edition

Visual redesign sofisticado com foco em performance e experiência do usuário (UX).

## Funcionalidades Principais (Mantidas & Aprimoradas)
- **Timer de Foco:** Pomodoro customizável com anel de progresso SVG e modo ocultável.
- **Árvore de Notas:** Organização hierárquica recursiva (Reddit-style) com guias visuais verticais.
- **Checklist Inteligente:** Gerenciamento de tarefas com barra de progresso em tempo real.
- **Links [[ ]]:** Suporte a conexões entre notas estilo Obsidian.
- **Persistência Robusta:** Sincronização inteligente com LocalStorage para evitar perda de dados.

## Novidades Visuais & UX
- **Estética Dark Liquid Glass:** Inspirado em Frutiger Aero e VisionOS, com tons de cinza e preto sóbrios.
- **Glassmorphism Profundo:** Uso intenso de `backdrop-filter`, reflexos internos e bordas vítreas.
- **Orbes Animados:** Background dinâmico com orbes que flutuam suavemente.
- **Gestão de Imagens:**
  - **Compressão Inteligente:** Redimensionamento automático de imagens (JPEG) para otimizar espaço no LocalStorage.
  - **Thumbnails Padronizados:** Visualização uniforme em tamanho médio (240x160px) com `object-fit: cover`.
  - **Image Viewer:** Overlay dedicado para expandir e visualizar imagens em tamanho real.
- **Layout Refinado:** Hierarquia visual otimizada (Título -> Imagem -> Texto) e suporte a notas sem título.
- **Navegação em Massa:** Botões para expandir e recolher recursivamente toda a árvore de notas.

## Stack Técnica
- Vanilla JavaScript (ES6+)
- CSS Moderno (Variables, Flexbox, Grid, Animations)
- LocalStorage para persistência offline
- Canvas API para processamento de imagens client-side
