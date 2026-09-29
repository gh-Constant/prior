package gamification

// Item kinds match the equip slots on the client.
const (
	KindBorder   = "border"
	KindTitle    = "title"
	KindPetHat   = "pet-hat"
	KindPetFace  = "pet-face"
	KindPetNeck  = "pet-neck"
	KindPetRoom  = "pet-room"
	KindConfetti = "confetti"
)

// Catalog lists every cosmetic a chest can drop. Borders are not in it:
// they are earned through achievements, never rolled. Ids are stable: they
// are stored in inventory_items and rendered by the client
// (app/src/lib/gamification/catalog.ts), which draws every one of them.
var Catalog = []Item{
	{ID: "hat-party", Kind: KindPetHat, Rarity: Common},
	{ID: "hat-beanie", Kind: KindPetHat, Rarity: Common},
	{ID: "hat-flower", Kind: KindPetHat, Rarity: Rare},
	{ID: "hat-crown", Kind: KindPetHat, Rarity: Legendary},
	{ID: "face-glasses", Kind: KindPetFace, Rarity: Common},
	{ID: "face-shades", Kind: KindPetFace, Rarity: Epic},
	{ID: "neck-scarf", Kind: KindPetNeck, Rarity: Common},
	{ID: "neck-bowtie", Kind: KindPetNeck, Rarity: Common},
	{ID: "neck-bell", Kind: KindPetNeck, Rarity: Rare},
	{ID: "room-rug", Kind: KindPetRoom, Rarity: Common},
	{ID: "room-plant", Kind: KindPetRoom, Rarity: Common},
	{ID: "room-cushion", Kind: KindPetRoom, Rarity: Common},
	{ID: "room-lamp", Kind: KindPetRoom, Rarity: Rare},
	{ID: "room-shelf", Kind: KindPetRoom, Rarity: Rare},
	{ID: "room-frame", Kind: KindPetRoom, Rarity: Epic},
	{ID: "room-lights", Kind: KindPetRoom, Rarity: Epic},
	{ID: "confetti-pastel", Kind: KindConfetti, Rarity: Common},
	{ID: "confetti-ocean", Kind: KindConfetti, Rarity: Common},
	{ID: "confetti-gold", Kind: KindConfetti, Rarity: Rare},
	{ID: "confetti-neon", Kind: KindConfetti, Rarity: Rare},
	{ID: "confetti-sakura", Kind: KindConfetti, Rarity: Epic},
	{ID: "title-dreamer", Kind: KindTitle, Rarity: Common},
	{ID: "title-tinkerer", Kind: KindTitle, Rarity: Rare},
	{ID: "title-starlit", Kind: KindTitle, Rarity: Epic},
	{ID: "title-mythmaker", Kind: KindTitle, Rarity: Legendary},
}

// Everyone starts with these: a plain border and the classic confetti.
var StarterItems = []string{"border-common-ring", "confetti-classic"}

// ItemKind resolves any item a user may own, from the catalog, the
// achievement rewards or the starter set.
func ItemKind(id string) (string, bool) {
	for _, item := range Catalog {
		if item.ID == id {
			return item.Kind, true
		}
	}
	for _, achievement := range Achievements {
		if achievement.Border == id {
			return KindBorder, true
		}
		if achievement.Title == id {
			return KindTitle, true
		}
	}
	switch id {
	case "border-common-ring":
		return KindBorder, true
	case "confetti-classic":
		return KindConfetti, true
	}
	return "", false
}

// EquipSlots maps each equip slot to the item kind it accepts. The name
// effect slot is special: it takes a NameEffect unlocked by level.
var EquipSlots = map[string]string{
	"border":   KindBorder,
	"title":    KindTitle,
	"petHat":   KindPetHat,
	"petFace":  KindPetFace,
	"petNeck":  KindPetNeck,
	"petRoom":  KindPetRoom,
	"confetti": KindConfetti,
}

const NameEffectSlot = "nameEffect"
