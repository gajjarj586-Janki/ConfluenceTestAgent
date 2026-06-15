Feature: Form submission on Find A Dealer

  Background:
    Given I am a user on the Find a Dealer Page
  
  @BATD 
  Scenario: Book a test drive On FAD
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Test Drive FIFO PCM2 - Test Data"
    And the user navigates to Find a Dealer
    When the user sets Dealer Type to Sales
    And the user inputs Postcode on Location from test data
    And user clicks on Search on Find your local dealer
    And user clicks on Book a test drive
    Then the form modal is displayed
    When the user selects Model from test data
    And the user selects Powertrain from test data
    And the user clicks Next
    Then location modal should be displayed
    When user clicks on Next
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
    Scenario: Contact a Dealer on FAD
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data " Contact a dealer FIFO PCM2- Test Data"
    And the user navigates to Find a Dealer
    When the user sets Dealer Type to Sales 
    And the user inputs Postcode on Location field test data
    And user clicks on Search on Find your local dealer
    And user clicks on Contact dealer
    Then the form modal is displayed
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

    @BookAService @Rego
    Scenario: Book a Service on FAD
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Book a Service - Test Data"
    And the user navigates to Find a dealer
    When the user sets Dealer Type to Service
    And the user inputs Postcode on Location from test data
    And user clicks on Search on Find your local dealer
    And the user clicks Quote & Book a Service
    Then form modal is displayed
    When the user enters rego number from test data
    And the user fills State from test data
    And click on Search Vehicle button
    Then it will return status code 200 in the API
    And user transits to /find-a-dealer/book-a-service link
    And message shows Dealer "Showroom opening soon"

    