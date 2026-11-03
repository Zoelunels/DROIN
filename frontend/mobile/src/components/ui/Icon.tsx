import React from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Baby,
  Banknote,
  Beer,
  Bike,
  BookOpen,
  Briefcase,
  Brush,
  Bus,
  CakeSlice,
  Calculator,
  Camera,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Coffee,
  CreditCard,
  CupSoda,
  Download,
  Droplet,
  Dumbbell,
  Ellipsis,
  Eye,
  EyeOff,
  FileText,
  Film,
  Folder,
  Fuel,
  Gamepad2,
  Gem,
  Gift,
  GraduationCap,
  Hand,
  HandHeart,
  Handshake,
  Headphones,
  Heart,
  Hospital,
  House,
  Image,
  Images,
  Info,
  Keyboard,
  Landmark,
  Lightbulb,
  Lock,
  LogOut,
  Luggage,
  Mail,
  MessageCircleMore,
  Moon,
  Mic,
  Motorbike,
  Paperclip,
  PawPrint,
  PencilLine,
  PiggyBank,
  Pill,
  Plane,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat,
  Sandwich,
  Scissors,
  Search,
  Shield,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sparkles,
  Square,
  SquareParking,
  Star,
  Store,
  Sun,
  Tag,
  Tags,
  TrainFront,
  Trash,
  TrendingUp,
  Tv,
  User,
  Users,
  Utensils,
  Wallet,
  Wifi,
  WifiOff,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react-native'

/**
 * Every icon in DROIN is Lucide (the set shadcn/ui uses); the app shows no emoji. Screens ask for a
 * name from this list. Category icons are stored on the server by these same names (the server's
 * default categories already use utensils, bus, bolt, briefcase…), so the list doubles as the
 * category icon vocabulary: see lib/icons.ts for the picker and the name-based guesses.
 */
const ICONS = {
  // Interface
  add: Plus,
  alert: CircleAlert,
  archive: Archive,
  attach: Paperclip,
  back: ChevronLeft,
  camera: Camera,
  check: Check,
  'check-circle': CircleCheck,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'chevron-right': ChevronRight,
  close: X,
  document: FileText,
  download: Download,
  edit: PencilLine,
  eye: Eye,
  'eye-off': EyeOff,
  gallery: Images,
  hand: Hand,
  image: Image,
  in: ArrowDown,
  info: Info,
  keyboard: Keyboard,
  lightbulb: Lightbulb,
  lock: Lock,
  'log-out': LogOut,
  mail: Mail,
  message: MessageCircleMore,
  mic: Mic,
  moon: Moon,
  offline: WifiOff,
  out: ArrowUp,
  refresh: RefreshCw,
  search: Search,
  sparkles: Sparkles,
  stop: Square,
  sun: Sun,
  tags: Tags,
  trash: Trash,
  user: User,

  // Money: wallets, transfers, debts
  bank: Landmark,
  card: CreditCard,
  cash: Banknote,
  debt: Handshake,
  folder: Folder,
  phone: Smartphone,
  'piggy-bank': PiggyBank,
  receipt: ReceiptText,
  transfer: Repeat,
  wallet: Wallet,

  // Categories (names match the server's default category icons)
  baby: Baby,
  basket: ShoppingBasket,
  beer: Beer,
  bike: Bike,
  bolt: Zap,
  book: BookOpen,
  briefcase: Briefcase,
  brush: Brush,
  bus: Bus,
  cake: CakeSlice,
  calculator: Calculator,
  car: Car,
  cart: ShoppingCart,
  chart: TrendingUp,
  coffee: Coffee,
  dots: Ellipsis,
  drink: CupSoda,
  droplet: Droplet,
  dumbbell: Dumbbell,
  film: Film,
  fuel: Fuel,
  game: Gamepad2,
  gem: Gem,
  gift: Gift,
  graduation: GraduationCap,
  'hand-heart': HandHeart,
  heart: Heart,
  home: House,
  hospital: Hospital,
  luggage: Luggage,
  motorbike: Motorbike,
  music: Headphones,
  parking: SquareParking,
  paw: PawPrint,
  people: Users,
  pill: Pill,
  plane: Plane,
  sandwich: Sandwich,
  scissors: Scissors,
  shield: Shield,
  shirt: Shirt,
  'shopping-bag': ShoppingBag,
  sofa: Sofa,
  star: Star,
  store: Store,
  tag: Tag,
  train: TrainFront,
  tv: Tv,
  utensils: Utensils,
  wifi: Wifi,
  wrench: Wrench,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

export const isIconName = (value: string | null | undefined): value is IconName => !!value && value in ICONS

/** An icon in a rounded square: category, wallet and transaction pictures. */
export function IconTile({
  name,
  size = 42,
  bg,
  color,
  style,
}: {
  name: IconName
  size?: number
  bg: string
  color: string
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[{ width: size, height: size, borderRadius: Math.round(size * 0.31), backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Icon name={name} size={Math.round(size * 0.5)} color={color} />
    </View>
  )
}

export function Icon({
  name,
  size = 20,
  color,
  strokeWidth = 2,
  filled,
  style,
  accessibilityLabel,
}: {
  name: IconName
  size?: number
  color: string
  /** Lucide's line weight; 2.5 reads as "selected". */
  strokeWidth?: number
  /** Fills the shape with the same colour (a solid stop button, for example). */
  filled?: boolean
  style?: StyleProp<ViewStyle>
  /** Only when the icon carries meaning on its own (no text next to it says the same). */
  accessibilityLabel?: string
}) {
  const Glyph = ICONS[name]
  const glyph = <Glyph size={size} color={color} strokeWidth={strokeWidth} fill={filled ? color : 'none'} style={accessibilityLabel ? undefined : style} />
  // A label goes on a wrapping View: react-native-svg hands accessibility props to the <svg> tag on
  // web as invalid attributes, while a View maps them properly on every platform.
  if (!accessibilityLabel) return glyph
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={style}>
      {glyph}
    </View>
  )
}
