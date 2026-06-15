Feature: Verify Driveaway price from ROAP and Calculator page
  As an admin user
  I want to fetch the test data for vehicle/variant and related options from the Confluence "Automation Test Data" page,
  And capture the Driveaway price from ROAP admin portal
  And verify the same price is displayed on the Hyundai Calculator page
  So that I can ensure price consistency between ROAP and Calculator

  Background:
    Given the user has loaded the test data from the Confluence page "Automation Test Data" and found the test data for "Driveaway Price - Test Data"
    And I launch the browser in non-headless mode

  @smoke @regression
  Scenario: Capture Driveaway price from ROAP and verify on Calculator page
    Given I navigate to the ROAP login page
    When I enter username and password from test data
    And I click on the "Log In" button
    And I click on the "Model" button
    And I select the Vehicle from test data
    And I select the ROAP Variant from test data
    And I select the ROAP Engine from test data
    And I select the ROAP Transmission from test data
    And I capture the driveaway price from ROAP
    And I navigate to the calculator page
    And I enter postcode from test data
    And I select the suburb from test data
    And I click on "Set dealer" button
    And I select Site_Variant "<site_variant>" from test data
    And I select Site_Powertrain "<site_powertrain>" from test data
    And I select Extended Range Option Pack from test data
    And I select Roof Basket Option Pack from test data
    And I select Site_Transmission "<site_transmission>" from test data
    And I click on "View price summary" button
    Then I verify the captured driveaway price matches on calculator page
