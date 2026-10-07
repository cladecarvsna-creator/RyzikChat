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
)

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
