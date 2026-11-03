import React from 'react'
import { Pressable, View } from 'react-native'
import { Icon, type IconName } from '@/components/ui/Icon'
import { makeStyles, useColors } from '@/constants/colors'
import { CATEGORY_ICON_CHOICES } from '@/lib/icons'

/** Grid of category icons (Lucide); the picked one is filled ink with a light icon. */
export function IconPicker({ value, onChange }: { value: IconName | null; onChange: (icon: IconName) => void }) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <View style={styles.grid}>
      {CATEGORY_ICON_CHOICES.map((name) => {
        const on = name === value
        return (
          <Pressable
            key={name}
            onPress={() => onChange(name)}
            accessibilityRole="button"
            accessibilityLabel={`Icon: ${name.replace(/-/g, ' ')}`}
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [
              styles.tile,
              on ? styles.tileOn : { backgroundColor: pressed ? Colors.orangeSoft : Colors.cream, borderColor: Colors.borderLight },
            ]}
          >
            <Icon name={name} size={20} color={on ? Colors.surface : Colors.charcoal} strokeWidth={on ? 2.4 : 2} />
          </Pressable>
        )
      })}
    </View>
  )
}

const useStyles = makeStyles((Colors) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { width: 42, height: 42, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tileOn: { backgroundColor: Colors.charcoal, borderColor: Colors.charcoal },
}))
