package app.ryzik.chat.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// ---------- То, что приходит с сервера ----------

@Serializable
data class Badge(
    val id: String,
    val emoji: String,
    val title: String,
    val description: String = "",
    val color: String = "#6750A4",
)

@Serializable
data class User(
    val id: String,
    val username: String,
    val displayName: String,
    val bio: String = "",
    val avatarFileId: String? = null,
    val isAdmin: Boolean = false,
    val isPremium: Boolean = false,
    val publicKey: String = "",
    val online: Boolean = false,
    val lastSeen: Long = 0,
    val badges: List<Badge> = emptyList(),
    /** Премиум: эмодзи рядом с именем. */
    val emojiStatus: String? = null,
    /** Премиум: оформление профиля. */
    val profileStyle: ProfileStyle? = null,
    /** Для текущего пользователя: в контактах ли этот человек и заблокирован ли он. */
    val isContact: Boolean = false,
    val isBlocked: Boolean = false,
    /** Служебный аккаунт RyzikChat Info. */
    val isService: Boolean = false,
    /** Только для себя: включена ли двухэтапная проверка и подсказка к ней. */
    val has2fa: Boolean = false,
    val twofaHint: String = "",
    /** Модерация. isBanned видят все; сроки и причины — сам пользователь (ограничение) и админы. */
    val isBanned: Boolean = false,
    val bannedUntil: Long? = null,
    val banReason: String = "",
    val restrictedUntil: Long? = null,
    val restrictReason: String = "",
    val createdAt: Long = 0,
    /** Сколько FLUX стоит написать этому человеку, если вы не у него в контактах. */
    val messagePrice: Int = 0,
    /** Кто может звонить: all, contacts, nobody. */
    val callPrivacy: String = "all",
    /** Только для себя: баланс FLUX и до какого времени куплен Премиум. */
    val flux: Long = 0,
    val premiumUntil: Long? = null,
)

@Serializable
data class FluxTx(val id: String, val amount: Long, val kind: String, val note: String = "", val createdAt: Long = 0)

@Serializable
data class FluxInfo(val balance: Long = 0, val premiumMonthPrice: Long = 1000, val history: List<FluxTx> = emptyList())

/** Подарок (NFT) на витрине. supply = null — без ограничения тиража. */
@Serializable
data class GiftItem(
    val id: String,
    val title: String,
    val description: String = "",
    val fileId: String,
    val price: Long,
    val supply: Int? = null,
    val sold: Int = 0,
    val left: Int? = null,
    val active: Boolean = true,
    val kind: String = "nft",
    val emoji: String? = null,
    val caption: String = "",
    val animation: String = "none",
)

/** Купленный экземпляр подарка с номером. */
@Serializable
data class OwnedGift(
    val id: String,
    val serial: Int,
    val item: GiftItem? = null,
    val ownerId: String = "",
    val from: User? = null,
    val message: String = "",
    val hidden: Boolean = false,
    val createdAt: Long = 0,
)

/** Группа или канал глазами модератора. */
@Serializable
data class AdminChat(
    val id: String,
    val type: String,
    val title: String = "",
    val description: String = "",
    val avatarFileId: String? = null,
    val isPublic: Boolean = false,
    val banned: Boolean = false,
    val banReason: String = "",
    val memberCount: Int = 0,
    val owner: User? = null,
    val createdAt: Long = 0,
)

/** Запись журнала модерации. */
@Serializable
data class ModerationLogEntry(
    val id: String,
    val action: String,
    val targetType: String,
    val targetId: String,
    val targetName: String = "",
    val reason: String = "",
    val until: Long? = null,
    val createdAt: Long = 0,
    val admin: User? = null,
)

/** Срок «навсегда» на сервере. */
const val FOREVER_UNTIL = 253402300799000L

/** Ответ на вход: либо сразу сессия, либо нужен пароль двухэтапной проверки. */
@Serializable
data class LoginResponse(
    val token: String? = null,
    val user: User? = null,
    val encryptedPrivateKey: String? = null,
    val need2fa: Boolean = false,
    val challengeId: String? = null,
    /** Подсказка к паролю двухэтапной проверки. */
    val hint: String = "",
)

/** Оформление профиля с Премиумом. Цвета в виде #RRGGBB. */
@Serializable
data class ProfileStyle(
    val color1: String? = null,
    val color2: String? = null,
    val nameColor: String? = null,
    /** Эмодзи, которым усыпана шапка профиля. */
    val pattern: String? = null,
    /** Картинка-обложка шапки. */
    val bannerFileId: String? = null,
    /** Рамка аватарки: none | gradient | glow | pulse. */
    val ring: String? = null,
    /** Эффект шапки: none | shimmer | float | sparkle. */
    val effect: String? = null,
    /** Шрифт имени: default | serif | mono | rounded. */
    val font: String? = null,
)

@Serializable
data class Reaction(val userId: String, val emoji: String)

@Serializable
data class Message(
    val id: String,
    val chatId: String,
    val seq: Long,
    val senderId: String,
    val type: String,
    val payload: String? = null,
    val replyTo: String? = null,
    val forwardedFrom: String? = null,
    val clientId: String? = null,
    val createdAt: Long,
    val editedAt: Long? = null,
    val deleted: Boolean = false,
    val reactions: List<Reaction> = emptyList(),
)

@Serializable
data class ChatMember(val user: User, val role: String)

@Serializable
data class Chat(
    val id: String,
    val type: String, // direct | group | saved | channel
    val title: String = "",
    val description: String = "",
    val memberCount: Int = 0,
    val myRole: String? = null,
    val avatarFileId: String? = null,
    /** Обои чата из фото: одни на всех участников. */
    val wallpaperFileId: String? = null,
    /** Заблокирован модерацией. */
    val banned: Boolean = false,
    val banReason: String = "",
    /** Открытый: ищется и вступить может любой. Частный: только по ссылке. */
    val isPublic: Boolean = false,
    /** Публичный @юзернейм группы или канала. */
    val username: String? = null,
    val inviteCode: String? = null,
    /** Служебный чат RyzikChat Info. */
    val isService: Boolean = false,
    /** Личный чат: собеседник у меня в контактах / заблокирован мной. */
    val peerIsContact: Boolean = false,
    val peerBlocked: Boolean = false,
    val createdBy: String = "",
    val createdAt: Long = 0,
    val members: List<ChatMember> = emptyList(),
    val lastMessage: Message? = null,
    val unread: Int = 0,
    val lastReadSeq: Long = 0,
    val pinned: Boolean = false,
    val muted: Boolean = false,
    val archived: Boolean = false,
)

@Serializable
data class AuthResponse(val token: String, val user: User, val encryptedPrivateKey: String)

@Serializable
data class UploadedFile(val id: String, val size: Long, val mime: String)

@Serializable
data class SessionInfo(val id: String, val device: String, val createdAt: Long, val current: Boolean)

@Serializable
data class ReadState(val userId: String, val seq: Long)

@Serializable
data class ApiError(val error: String = "", val message: String = "")

// ---------- То, что лежит внутри зашифрованного сообщения ----------

/** Ссылка на зашифрованный файл: ключ знают только участники чата. */
@Serializable
data class FileRef(
    val id: String,
    val key: String,
    val name: String,
    val size: Long,
    val mime: String,
    val width: Int = 0,
    val height: Int = 0,
    val durationMs: Long = 0,
    /** Для голосовых: громкость по ходу записи, base64 от массива байт 0..100. */
    val waveform: String = "",
    /** Квадратное видеосообщение («квадратик»). */
    val square: Boolean = false,
)

@Serializable
data class Content(
    val text: String = "",
    val file: FileRef? = null,
    val sticker: StickerRef? = null,
    val gift: GiftRef? = null,
    val call: CallRef? = null,
)

/** Подарок в сообщении. Сервер пишет его в личный чат, когда кто-то дарит подарок. */
@Serializable
data class GiftRef(
    val giftId: String,
    val itemId: String = "",
    val title: String = "",
    val fileId: String = "",
    val serial: Int = 0,
    val supply: Int? = null,
    val price: Long = 0,
    val message: String = "",
    val kind: String = "nft",
    val emoji: String? = null,
    val caption: String = "",
    val animation: String = "none",
)

/** Запись о звонке в чате. status: ok, missed, declined, busy, cancelled, failed. */
@Serializable
data class CallRef(val video: Boolean = false, val status: String = "ok", val duration: Long = 0)

/** Стикер в сообщении: картинка лежит на сервере открыто, как аватарка. */
@Serializable
data class StickerRef(val packId: String, val id: String, val fileId: String, val emoji: String = "")

@Serializable
data class Sticker(val id: String, val fileId: String, val emoji: String = "")

@Serializable
data class StickerPack(
    val id: String,
    val title: String,
    val ownerId: String = "",
    val isMine: Boolean = false,
    val isAdded: Boolean = false,
    val stickers: List<Sticker> = emptyList(),
)

/** Ссылка, по которой друг откроет набор стикеров. */
fun stickerPackLink(id: String) = "ryzik://stickers/$id"

// ---------- События WebSocket ----------

@Serializable
data class RealtimeEvent(
    val type: String,
    val message: Message? = null,
    val chat: Chat? = null,
    val chatId: String? = null,
    val userId: String? = null,
    val user: User? = null,
    val seq: Long? = null,
    val online: Boolean? = null,
    val lastSeen: Long? = null,
    val action: String? = null,
    val from: String? = null,
    val data: JsonObject? = null,
    /** chat.new: кто добавил; reaction: id сообщения и эмодзи. */
    val by: String? = null,
    val messageId: String? = null,
    val emoji: String? = null,
)

/** Подпись звонка для списка чатов и уведомлений. */
fun callText(c: CallRef?): String {
    val kind = if (c?.video == true) "Видеозвонок" else "Звонок"
    return when (c?.status) {
        "ok" -> "$kind · ${callDuration(c.duration)}"
        "missed" -> "Пропущенный ${kind.lowercase()}"
        "declined" -> "$kind отклонён"
        "busy" -> "$kind: занято"
        "forbidden" -> "$kind: звонки ограничены"
        "cancelled" -> "Отменённый ${kind.lowercase()}"
        else -> "$kind не состоялся"
    }
}

fun callDuration(ms: Long): String {
    val s = ms / 1000
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

@Serializable
data class UsernameCheck(val ok: Boolean, val error: String? = null, val message: String? = null)

/** Самообновление сервера (админ-панель → Сервер). */
@Serializable
data class ServerStatus(
    val version: String = "",
    val latest: String? = null,
    val autoUpdate: Boolean = true,
    val supervised: Boolean = false,
    val checkedAt: Long? = null,
    val error: String? = null,
    val updating: Boolean = false,
    val updatedTo: String? = null,
)

@Serializable
data class ServerUpdateResult(val updated: Boolean, val version: String, val latest: String? = null, val restarting: Boolean = false)
