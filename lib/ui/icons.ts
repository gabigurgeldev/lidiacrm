/**
 * Canonical icon map. Toda feature importa daqui — não direto de @phosphor-icons/react.
 * ADR-05 (Spec 09 §12). Permite swap futuro sem big-bang refactor.
 *
 * Re-exporting from `@phosphor-icons/react/dist/ssr` so Server Components can
 * render icons without forcing the entire CSR React-context module client-side.
 * Client Components still get fully interactive icons (size/weight/color).
 */

export {
  // navigation (inbox icon = Tray in Phosphor)
  Tray as Inbox,
  ListChecks,
  Plugs,
  PlugsConnected,
  QrCode,
  Kanban,
  Users,
  UsersThree,
  Storefront,
  Robot,
  Sparkle,
  ShieldCheck,
  Gear,
  House,
  // admin platform
  Buildings,
  FlowArrow,
  // flow engine: paralelo, reencontro, repeticao, espera por evento
  ArrowsSplit,
  ArrowsMerge,
  Repeat,
  Hourglass,
  ChatsCircle,
  ClipboardText,
  Scales,
  Gauge,
  WifiSlash,
  Clock,
  // marca da instalação (o revendedor troca nome e cor do produto)
  Palette,
  // health dashboard
  WifiHigh,
  Brain,
  ArrowsClockwise,
  Dot,
  // actions
  ArrowBendUpLeft,
  List,
  Bell,
  BellSlash,
  PaperPlaneTilt,
  Smiley,
  Check,
  Checks,
  X,
  Plus,
  Trash,
  PencilSimple,
  MagnifyingGlass,
  Pause,
  Play,
  SkipForward,
  Copy,
  DownloadSimple,
  Archive,
  // origem de uma captação de formulário (página, IP, link para o lead)
  Globe,
  ArrowSquareOut,
  Tray,
  // feedback
  CheckCircle,
  Warning,
  WarningOctagon,
  Info,
  CircleNotch,
  // lgpd
  Scales as ScalesSimple,
  Eye,
  ChartBar,
  ClockCountdown,
  // painéis de evolução / aprendizado
  ChartLineUp,
  Lightbulb,
  // theme
  Sun,
  Moon,
  MonitorPlay,
  // conversation
  ChatCircle,
  // flow engine: mandar mensagem para o cliente (distinto do aviso ao vendedor)
  ChatCircleText,
  // flow engine: disparo em massa
  Megaphone,
  Phone,
  Paperclip,
  Microphone,
  Image as ImageIcon,
  ImageSquare,
  MusicNote,
  Note,
  FileText,
  Lock,
  Receipt,
  Tag,
  Question,
  Keyboard,
  // followup flow builder (Task 6.2)
  GitBranch,
  Flag,
  // misc
  DotsThree,
  CaretDown,
  CaretUp,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  ArrowRight,
  SignOut,
  WebhooksLogo,
  PuzzlePiece,
  UploadSimple,
  Signpost,
  // atualização de versão
  ArrowCircleUp,
  // navegação agrupada (registro em lib/navigation/registry.ts)
  Funnel,
  BookOpen,
  Key,
  UserCircle,
  ClockCounterClockwise,
  // inbox no celular: voltar para a lista e abrir a ficha do contato
  IdentificationCard,
  // agenda (o barril não tinha NENHUM ícone de calendário até aqui)
  CalendarBlank,
  CalendarDots,
  CalendarPlus,
  CalendarX,
  CalendarCheck,
  GoogleLogo,
  MapPin,
  ArrowsOutSimple,
  // casca da navegação (redesign): ícone de GRUPO no sidebar, chevron do
  // recolhimento e os dois destinos cujo ícone disputava sentido com o vizinho.
  //
  // `Radar` foi pedido para /app/radar e NÃO EXISTE no Phosphor 2.1 (conferido
  // no `dist/ssr` instalado). O destino segue com `ClockCountdown`, que é o que
  // a tela faz: mostrar quem esfriou com o relógio correndo.
  Headset,
  ChatText,
  // O selo de tipo de conexão do inbox: `WhatsappLogo` é a marca de verdade
  // (pedido explícito), `SealCheck` marca o canal oficial da Meta.
  WhatsappLogo,
  SealCheck,
  // A silhueta que substitui as iniciais quando o contato não tem foto —
  // é o desenho que o WhatsApp usa, e ele diz "não temos a foto" em vez de
  // fingir informação sobre a pessoa.
  User,
  SquaresFour,
  FunnelSimple,
} from "@phosphor-icons/react/dist/ssr";
