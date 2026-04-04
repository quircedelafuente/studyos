#!/usr/bin/env ruby
# remove_screen_time_entitlements.rb
# Elimina CODE_SIGN_ENTITLEMENTS del target App para que el build funcione
# con un equipo personal gratuito (que no soporta FamilyControls).
#
# Uso:  cd ios/App && ruby remove_screen_time_entitlements.rb

require 'xcodeproj'

PROJECT_PATH = File.expand_path('../App.xcodeproj', __FILE__)
proj         = Xcodeproj::Project.open(PROJECT_PATH)
app_target   = proj.targets.find { |t| t.name == 'App' }
raise 'Target App no encontrado' unless app_target

%w[Debug Release].each do |config|
  settings = app_target.build_configuration_list[config].build_settings
  if settings['CODE_SIGN_ENTITLEMENTS']
    settings.delete('CODE_SIGN_ENTITLEMENTS')
    puts "🔓  CODE_SIGN_ENTITLEMENTS eliminado (#{config})"
  else
    puts "ℹ️   CODE_SIGN_ENTITLEMENTS ya estaba vacío (#{config})"
  end
end

proj.save
puts ''
puts '✅  Entitlements eliminados. La app compilará con equipo personal.'
puts '   FamilyControls/Screen Time requiere cuenta de pago (Apple Developer Program).'
puts ''
puts '⚠️  PRÓXIMOS PASOS:'
puts '   1. Product → Clean Build Folder (⌘⇧K)'
puts '   2. Ejecuta en el dispositivo'
