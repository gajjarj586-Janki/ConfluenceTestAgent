Feature: Form submission on Hyundai Pip Page

  Background:
    Given I am a user on the Hyundai Pip Page
 
  @BATD 
  Scenario: Book a test drive on Sticky CTA Pip Page
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Test Drive FIFO PCM2 - Test Drive"
    And the user navigates to Pip Page
    And the user sets location postcode from test data
    And user clicks on Buying Tools
    And user selects Test Drive
    And the form modal is displayed
    And the user selects Powertrain from test data and clicks Next
    And the user clicks Next
    And the user fills first name from test data
    And the user fills last name from test data
    And the user fills email address from test data
    And the user fills phone number from test data
    And the user selects purchase timeframe from test data
    And the user accepts consent checkbox 1
    And the user accepts consent checkbox 2
    And the user clicks Submit request
    Then the BATD submission is successful
    And it will return status code 200 in the API
    And a confirmation message should be displayed 

  @CAD
    Scenario: Contact a Dealer on Sticky CTA pip page
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data " Contact a dealer FIFO PCM2- Test Data"
    And the user navigates to Pip Page
    And the user sets location postcode from test data
    And user clicks on Buying Tools    
    And user selects on Contact a dealer
    And the form modal is displayed
    When the user fills first name from test data
    And the user fills last name from test data
    And the user fills email address from test data
    And the user fills phone number from test data
    And the user fills postcode from test data
    And the user selects purchase timeframe from test data
    And the user selects Model from test data
    And the user selects Powertrain from test data
    And the user accepts consent checkbox 1
    And the user accepts consent checkbox 2
    And the user clicks Submit button
    Then the CAD submission is successful
    And it will return status code 200 in the API
    And a confirmation message should be displayed 
