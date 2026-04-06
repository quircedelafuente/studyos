#!/usr/bin/env ruby
# setup_widgets.rb
# Añade los 4 home-screen widgets al target StudyWidget y configura App Groups.
#
# Uso: ruby setup_widgets.rb

require 'xcodeproj'

PROJECT_PATH   = File.expand_path('../App.xcodeproj', __FILE__)
WIDGET_DIR     = File.expand_path('../StudyWidget', __FILE__)
APP_DIR        = File.expand_path('../App', __FILE__)
TEAM_ID        = 'QCQL2JX4UQ'
APP_GROUP      = 'group.com.agustmun.iestudio'

proj        = Xcodeproj::Project.open(PROJECT_PATH)
app_target  = proj.targets.find { |t| t.name == 'App' }        or raise 'Target App no encontrado'
wgt_target  = proj.targets.find { |t| t.name == 'StudyWidget' } or raise 'Target StudyWidget no encontrado — ejecuta add_widget_target.rb primero'

# ── 1. CODE_SIGN_ENTITLEMENTS ──────────────────────────────────────────────
%w[Debug Release].each do |cfg|
  app_target.build_configuration_list[cfg].build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
  wgt_target.build_configuration_list[cfg].build_settings['CODE_SIGN_ENTITLEMENTS'] = 'StudyWidget/StudyWidget.entitlements'
end
puts '✅  CODE_SIGN_ENTITLEMENTS configurados'

# ── 2. Nuevos ficheros Swift en StudyWidget ────────────────────────────────
widget_group = proj.main_group.find_subpath('StudyWidget') ||
               proj.main_group.new_group('StudyWidget', 'StudyWidget')

NEW_WIDGET_FILES = %w[
  IEStudioWidgetData.swift
  DeadlinesWidget.swift
  TodaySessionWidget.swift
  ActiveSessionWidget.swift
  BBDeliveriesWidget.swift
].freeze

NEW_WIDGET_FILES.each do |filename|
  path = File.join(WIDGET_DIR, filename)
  raise "Falta: #{path}" unless File.exist?(path)

  already = wgt_target.source_build_phase.files.any? do |f|
    f.file_ref&.path == filename
  end
  next puts "   ⏭  #{filename} ya estaba en el target" if already

  ref = widget_group.new_reference(filename)
  ref.source_tree = '<group>'
  wgt_target.source_build_phase.add_file_reference(ref)
  puts "   📄  #{filename} → StudyWidget"
end

# ── 3. WidgetDataPlugin en App target ─────────────────────────────────────
app_group = proj.main_group.find_subpath('App') ||
            proj.main_group.new_group('App', 'App')

%w[WidgetDataPlugin.swift WidgetDataPlugin.m].each do |filename|
  path = File.join(APP_DIR, filename)
  raise "Falta: #{path}" unless File.exist?(path)

  already = app_target.source_build_phase.files.any? do |f|
    f.file_ref&.path == filename
  end
  next puts "   ⏭  #{filename} ya estaba en el target" if already

  ref = app_group.new_reference(filename)
  ref.source_tree = '<group>'
  app_target.source_build_phase.add_file_reference(ref)
  puts "   📄  #{filename} → App"
end

# ── 4. Guardar ────────────────────────────────────────────────────────────
proj.save
puts ''
puts '✅  setup_widgets.rb completado'
puts ''
puts '⚠️  PRÓXIMOS PASOS EN XCODE:'
puts "   1. Abre App.xcworkspace"
puts "   2. App target → Signing & Capabilities → + Capability → App Groups → #{APP_GROUP}"
puts "   3. StudyWidget target → Signing & Capabilities → + Capability → App Groups → #{APP_GROUP}"
puts '   4. Clean Build Folder (⌘⇧K) y ejecutar en dispositivo'
