import React from 'react'
import { Pressable, Text } from 'react-native'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Fonts, makeStyles, useColors } from '@/constants/colors'

/** Selectable chip for filters and pickers: 34 px tall, 10 px radius, charcoal when picked. */
export function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string
  icon?: IconName | null
  active?: boolean
  onPress?: () => void
}) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? Colors.charcoal : pressed ? Colors.cream : Colors.surface },
        { borderColor: active ? Colors.charcoal : Colors.borderLight },
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={active ? Colors.surface : Colors.charcoal} /> : null}
      <Text style={[styles.label, { color: active ? Colors.surface : Colors.charcoal }]}>{label}</Text>
    </Pressable>
  )
}

const useStyles = makeStyles((Colors) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  label: { fontSize: 14, fontFamily: Fonts.semibold },
}))
