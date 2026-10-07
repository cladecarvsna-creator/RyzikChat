package app.ryzik.chat.ui.emoji

import android.content.Context
import android.util.Log
import androidx.emoji2.text.EmojiCompat
import androidx.emoji2.text.MetadataRepo

/**
 * Эмодзи в стиле iOS: объёмный набор Fluent Emoji (MIT) из assets/emoji.
 * Шрифт собирается на CI скриптом tools/emoji/build_font.py. Compose сам подхватывает EmojiCompat,
 * поэтому эмодзи меняются во всех текстах: сообщениях, реакциях, поле ввода.
 */
object IosEmoji {
    const val ASSET = "emoji/ryzik_emoji.ttf"

    fun install(context: Context) {
        if (EmojiCompat.isConfigured()) return
        val assets = context.applicationContext.assets
        val loader = EmojiCompat.MetadataRepoLoader { callback ->
            Thread({
                try {
                    callback.onLoaded(MetadataRepo.create(assets, ASSET))
                } catch (t: Throwable) {
                    Log.w("IosEmoji", "Шрифт эмодзи не загрузился, остаются системные", t)
                    callback.onFailed(t)
                }
            }, "emoji-loader").start()
        }
        val config = object : EmojiCompat.Config(loader) {}
            .setReplaceAll(true)
            .setUseEmojiAsDefaultStyle(true)
        EmojiCompat.init(config)
    }
}
