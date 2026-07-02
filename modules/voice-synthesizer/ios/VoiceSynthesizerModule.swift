import ExpoModulesCore

public class VoiceSynthesizerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VoiceSynthesizer")

    Events("synthesisProgress")

    AsyncFunction("getVoicesAsync") {
      return [[String: Any]]()
    }

    AsyncFunction("synthesizeDocumentAsync") { (_: String, _: String, _: [String], _: String?) in
      throw NSError(
        domain: "VoiceSynthesizer",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "La sintesis nativa de documentos solo esta disponible en Android."]
      )
    }

    AsyncFunction("clearDocumentAudioAsync") { (_: String, _: String) in
      return
    }

    AsyncFunction("clearAudioFileAsync") { (_: String) in
      return
    }
  }
}
