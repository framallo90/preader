package expo.modules.bardokeys

import android.app.Activity
import android.view.ActionMode
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.SearchEvent
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Pasar de página con los botones de volumen, como en ReadEra.
 *
 * Android no le manda las teclas de volumen a React Native, así que hay que
 * interceptarlas antes: se envuelve el Window.Callback de la Activity (el que
 * recibe TODOS los eventos de la ventana) y se le sacan de la cola sólo las dos
 * teclas de volumen mientras la captura está prendida. Todo lo demás se delega
 * intacto al callback original.
 *
 * Por qué envolver el callback y no tocar MainActivity: la carpeta android/ la
 * genera `expo prebuild` y se borra entera cada vez que se regenera. Esto vive
 * en modules/, que sí está en git.
 *
 * La captura se prende sólo con un libro abierto y se apaga al salir: fuera del
 * lector los botones tienen que seguir subiendo y bajando el volumen.
 */
class BardoKeysModule : Module() {
  /** El envoltorio puesto ahora, o null si no estamos capturando. */
  private var wrapper: VolumeKeyCallback? = null
  /** La Activity a la que se lo pusimos, para devolvérselo a la correcta. */
  private var attachedTo: Activity? = null

  override fun definition() = ModuleDefinition {
    Name("BardoKeys")

    Events("volumeKey")

    // ¿Hay música de otra app sonando? Lo usa la restauración de la escucha al
    // arrancar: si hay, los botones de medios son de esa app, no nuestros.
    Function("isMusicActive") {
      val audioManager = appContext.reactContext?.getSystemService(android.content.Context.AUDIO_SERVICE) as? android.media.AudioManager
      audioManager?.isMusicActive ?: false
    }

    Function("setCaptureVolumeKeys") { enabled: Boolean ->
      val activity = appContext.activityProvider?.currentActivity ?: return@Function
      activity.runOnUiThread {
        if (enabled) attach(activity) else detach()
      }
    }

    OnDestroy {
      val activity = attachedTo ?: return@OnDestroy
      activity.runOnUiThread { detach() }
    }
  }

  private fun attach(activity: Activity) {
    // Si ya está puesto en esta misma ventana no se vuelve a envolver: dos
    // envoltorios encadenados dejarían el original inalcanzable al soltar.
    if (wrapper != null && attachedTo === activity) return
    detach()
    val original = activity.window?.callback ?: return
    val envuelto = VolumeKeyCallback(original)
    activity.window.callback = envuelto
    wrapper = envuelto
    attachedTo = activity
  }

  private fun detach() {
    val puesto = wrapper ?: return
    val activity = attachedTo
    // Sólo se devuelve el callback original si el nuestro sigue siendo el de
    // arriba; si alguien envolvió después, romperíamos su cadena.
    if (activity != null && activity.window?.callback === puesto) {
      activity.window.callback = puesto.base
    }
    wrapper = null
    attachedTo = null
  }

  /**
   * Delega todo al callback original salvo las teclas de volumen.
   *
   * Es largo y aburrido a propósito: Window.Callback es una interfaz de Java con
   * muchos métodos y hay que reenviarlos todos, o la ventana deja de funcionar
   * (menús, gestos, modo selección). Sólo el primero tiene lógica.
   */
  private inner class VolumeKeyCallback(val base: Window.Callback) : Window.Callback {
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
      val code = event.keyCode
      if (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN) {
        // Sólo al apretar, y sin repetir si se deja apretado: pasar veinte
        // páginas de golpe por dejar el dedo puesto no es lo que nadie quiere.
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
          sendEvent("volumeKey", mapOf("key" to if (code == KeyEvent.KEYCODE_VOLUME_UP) "up" else "down"))
        }
        // Se consume también el ACTION_UP, o Android igual muestra el panel de volumen.
        return true
      }
      return base.dispatchKeyEvent(event)
    }

    override fun dispatchKeyShortcutEvent(event: KeyEvent): Boolean = base.dispatchKeyShortcutEvent(event)
    override fun dispatchTouchEvent(event: MotionEvent): Boolean = base.dispatchTouchEvent(event)
    override fun dispatchTrackballEvent(event: MotionEvent): Boolean = base.dispatchTrackballEvent(event)
    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean = base.dispatchGenericMotionEvent(event)
    override fun dispatchPopulateAccessibilityEvent(event: AccessibilityEvent): Boolean =
      base.dispatchPopulateAccessibilityEvent(event)

    override fun onCreatePanelView(featureId: Int): View? = base.onCreatePanelView(featureId)
    override fun onCreatePanelMenu(featureId: Int, menu: Menu): Boolean = base.onCreatePanelMenu(featureId, menu)
    override fun onPreparePanel(featureId: Int, view: View?, menu: Menu): Boolean =
      base.onPreparePanel(featureId, view, menu)

    override fun onMenuOpened(featureId: Int, menu: Menu): Boolean = base.onMenuOpened(featureId, menu)
    override fun onMenuItemSelected(featureId: Int, item: MenuItem): Boolean = base.onMenuItemSelected(featureId, item)
    override fun onWindowAttributesChanged(attrs: WindowManager.LayoutParams?) = base.onWindowAttributesChanged(attrs)
    override fun onContentChanged() = base.onContentChanged()
    override fun onWindowFocusChanged(hasFocus: Boolean) = base.onWindowFocusChanged(hasFocus)
    override fun onAttachedToWindow() = base.onAttachedToWindow()
    override fun onDetachedFromWindow() = base.onDetachedFromWindow()
    override fun onPanelClosed(featureId: Int, menu: Menu) = base.onPanelClosed(featureId, menu)
    override fun onSearchRequested(): Boolean = base.onSearchRequested()
    override fun onSearchRequested(searchEvent: SearchEvent?): Boolean = base.onSearchRequested(searchEvent)
    override fun onWindowStartingActionMode(callback: ActionMode.Callback?): ActionMode? =
      base.onWindowStartingActionMode(callback)

    override fun onWindowStartingActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? =
      base.onWindowStartingActionMode(callback, type)

    override fun onActionModeStarted(mode: ActionMode?) = base.onActionModeStarted(mode)
    override fun onActionModeFinished(mode: ActionMode?) = base.onActionModeFinished(mode)
    override fun onPointerCaptureChanged(hasCapture: Boolean) = base.onPointerCaptureChanged(hasCapture)
  }
}
